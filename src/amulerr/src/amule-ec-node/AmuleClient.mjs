'use strict'

import ECProtocol from './ECProtocol.mjs'

import {
  EC_OPCODES,
  EC_TAGS,
  EC_TAG_TYPES,
  EC_SEARCH_TYPE,
  EC_VALUE_TYPE,
  EC_PREFS,
} from './ECDefs.mjs'

const DEBUG = false

/**
 * Attempt to fix Mojibake filenames where UTF-8 bytes were decoded as Latin-1
 * (e.g. "Ã©" → "é"). Only applies the correction if the round-trip is clean
 * (no replacement characters), so already-correct strings are left untouched.
 * Strings containing characters above U+00FF (Cyrillic, Greek, CJK, etc.) are
 * already correctly decoded Unicode and are returned unchanged.
 */
function fixMojibake(str) {
  if (typeof str !== 'string') return str
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xff) return str // already real Unicode, leave it
  }
  try {
    const decoded = Buffer.from(str, 'latin1').toString('utf8')
    if (!decoded.includes('\uFFFD')) return decoded
  } catch {}
  return str
}

class AmuleClient {
  /**
   * @param {string} host - aMule EC hostname or IP address
   * @param {number} port - aMule EC port (default 4712)
   * @param {string} password - EC access password
   * @param {Object} [options] - Additional options passed to ECProtocol
   */
  constructor(host, port, password, options = {}) {
    this.session = new ECProtocol(host, port, password, options)

    // Clear incremental state on reconnection — aMule resets its
    // server-side diff state, so our XOR buffers would produce corrupted
    // data (wrong partStatus/gapStatus/reqStatus) if not cleared.
    this.session.onReconnected = () => {
      this._ecBufferState = null
      console.log('[AmuleClient] Cleared incremental state after reconnection')
    }
  }

  /**
   * Connect to aMule and authenticate.
   */
  async connect() {
    await this.session.connect()
    await this.session.authenticate()
  }

  /**
   * Close the connection to aMule.
   */
  close() {
    this.session.close()
  }

  /**
   * Check if an EC response indicates success (EC_OP_NOOP).
   * @param {Object} response - Raw EC response
   * @returns {boolean} True if the response opcode is EC_OP_NOOP (0x01)
   * @private
   */
  _isSuccess(response) {
    return response.opcode === EC_OPCODES.EC_OP_NOOP
  }

  /**
   * Send a command targeting a file by hash.
   * @param {number} opcode - EC opcode to send
   * @param {string} fileHash - MD4 hash of the file
   * @returns {Promise<boolean>} True if the command succeeded
   * @private
   */
  async _sendFileCommand(opcode, fileHash) {
    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_PARTFILE,
        EC_TAG_TYPES.EC_TAGTYPE_HASH16,
        fileHash,
      ),
    ]
    const response = await this.session.sendPacket(opcode, reqTags)
    if (DEBUG) console.log('[DEBUG] Received response:', response)
    return this._isSuccess(response)
  }

  /**
   * Send a simple request and return the response as a tag tree.
   * @param {number} opcode - EC opcode to send
   * @returns {Promise<Object>} Parsed tag tree
   * @private
   */
  async _requestTagTree(opcode) {
    const response = await this.session.sendPacket(opcode, [])
    if (DEBUG) console.log('[DEBUG] Received response:', response)
    return this.buildTagTree(response.tags)
  }

  /**
   * Get aMule statistics (upload/download speed, shared file count, etc.).
   * @returns {Promise<Object>} Tag tree with stats fields
   */
  async getStats() {
    return this._requestTagTree(EC_OPCODES.EC_OP_STAT_REQ)
  }

  /**
   * Get the full list of shared files.
   * @returns {Promise<{fileName: string, fileHash: string, fileSize: number, transferred: number, transferredTotal: number, reqCount: number, reqCountTotal: number, acceptedCount: number, acceptedCountTotal: number, priority: number, path: string, completeSources: number, onQueue: number, ed2kLink: string, raw: Object}[]>} Parsed shared file objects
   */
  async getSharedFiles() {
    if (DEBUG) console.log('[DEBUG] Requesting shared files...')

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_GET_SHARED_FILES,
      [],
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    // As per aMule source (ECSpecialCoreTags.cpp CEC_SharedFile_Tag): the
    // top-level EC_TAG_KNOWNFILE tag itself carries the file's ECID as its
    // own value — it was never read here, so every returned item's `ecid`
    // was silently undefined (callers like torrents/delete's clearCompleted
    // rely on it to identify which file to clear).
    return response.tags.map((tag) => ({
      ecid: tag.humanValue ?? tag.value,
      ...this._parseSharedFileFields(tag),
      raw: this.buildTagTree(tag.children),
    }))
  }

  /**
   * Clear completed downloads from aMule's download list.
   * Sends EC_OP_CLEAR_COMPLETED with EC_TAG_ECID children for each ecid to clear.
   *
   * @param {number[]} ecids - Ecids to clear.
   * @returns {Promise<{ opcode: number, cleared: number[] }>} Response opcode and list of ecids sent.
   */
  async clearCompleted(ecids) {
    if (DEBUG) console.log('[DEBUG] Clearing completed downloads...')

    if (ecids.length === 0) {
      if (DEBUG) console.log('[DEBUG] No completed downloads to clear')
      return { opcode: 0, cleared: [] }
    }

    const tags = ecids.map((ecid) =>
      this.session.createTag(
        EC_TAGS.EC_TAG_ECID,
        EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        ecid,
      ),
    )

    if (DEBUG)
      console.log(
        `[DEBUG] Sending EC_OP_CLEAR_COMPLETED with ${tags.length} ecid(s):`,
        ecids,
      )

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_CLEAR_COMPLETED,
      tags,
    )

    if (DEBUG)
      console.log('[DEBUG] Clear completed response opcode:', response.opcode)

    return { opcode: response.opcode, cleared: ecids }
  }

  /**
   * Tell aMule to reload its shared files from disk.
   * @returns {Promise<boolean>} True if the reload was initiated successfully
   */
  async refreshSharedFiles() {
    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_SHAREDFILES_RELOAD,
      [],
    )
    if (DEBUG) console.log('[DEBUG] Received response:', response)
    return this._isSuccess(response)
  }

  /**
   * Get the full download queue.
   * @returns {Promise<Object[]>} Array of download objects with parsed fields
   */
  async getDownloadQueue() {
    if (DEBUG) console.log('[DEBUG] Requesting downloaded files...')

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_GET_DLOAD_QUEUE,
      [],
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return response.tags.map((tag) => {
      const fields = this._parseDownloadFields(tag)
      // As per aMule source (ECSpecialCoreTags.cpp CEC_PartFile_Tag ->
      // CEC_SharedFile_Tag base): the top-level EC_TAG_PARTFILE tag itself
      // carries the file's ECID as its own value — same gap as
      // getSharedFiles() below, same reason it matters for clearCompleted.
      fields.ecid = tag.humanValue ?? tag.value
      // Decode buffer fields (full data, no XOR — use ecid=0 as throwaway state)
      this._reconstructBufferFields(0, fields)
      if (this._ecBufferState) this._ecBufferState.delete(0)
      fields.raw = this.buildTagTree(tag.children)
      return fields
    })
  }

  /**
   * Start a search on the specified network.
   * @param {string} query - Search query string
   * @param {number} network - Network type (EC_SEARCH_TYPE value)
   * @param {string|null} [extension] - Optional file extension filter
   * @returns {Promise<Object[]>} Raw response tags
   * @private
   */
  async _search(query, network, extension = null) {
    if (DEBUG) console.log('[DEBUG] Requesting search...')

    // Make sure network flag is valid
    if (!Object.values(EC_SEARCH_TYPE).includes(network))
      throw new Error(`Invalid network type: ${network}`)

    // Prepare request
    let children = [
      {
        tagId: EC_TAGS.EC_TAG_SEARCH_NAME,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: query,
      },
    ]
    if (typeof extension === 'string' && extension.length > 0) {
      children.push({
        tagId: EC_TAGS.EC_TAG_SEARCH_EXTENSION,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: extension,
      })
    }
    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_SEARCH_TYPE,
        EC_TAG_TYPES.EC_TAGTYPE_UINT8,
        network,
        children,
      ),
    ]
    // Send request
    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_SEARCH_START,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return response.tags
  }

  /**
   * Get the progress status of an ongoing search.
   * @returns {Promise<Object[]>} Raw response tags with search progress
   * @private
   */
  async _getSearchRequestStatus() {
    if (DEBUG) console.log('[DEBUG] Requesting search request status...')

    // Send request
    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_SEARCH_PROGRESS,
      [],
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return response.tags
  }

  /**
   * Get the results of a completed search.
   * @returns {Promise<{ resultsLength: number, results: Object[] }>} Search results sorted by source count
   */
  async getSearchResults() {
    if (DEBUG) console.log('[DEBUG] Requesting search results...')

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_SEARCH_RESULTS,
      [],
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    const results = response.tags.map((tag) => this._parseDownloadFields(tag))
    results.sort((a, b) => (b.sourceCount || 0) - (a.sourceCount || 0))

    return { resultsLength: results.length, results }
  }

  /**
   * Start a search and poll until results are ready (up to 120s timeout).
   * @param {string} query - Search query string
   * @param {string|number} network - Network type: 'global', 'local', 'kad', or EC_SEARCH_TYPE value
   * @param {string} [extension] - Optional file extension filter
   * @returns {Promise<{ resultsLength: number, results: Object[] }>} Search results sorted by source count
   */
  async searchAndWaitResults({ query, network, timeoutMs = 20000, extension }) {
    const intervalMs = 1000
    const startTime = Date.now()

    if (!Object.values(EC_SEARCH_TYPE).includes(network)) {
      switch (network) {
        case 'global':
          network = EC_SEARCH_TYPE.EC_SEARCH_GLOBAL
          break
        case 'local':
          network = EC_SEARCH_TYPE.EC_SEARCH_LOCAL
          break
        case 'kad':
          network = EC_SEARCH_TYPE.EC_SEARCH_KAD
          break
      }
    }

    // Start the search
    await this._search(query, network, extension)

    if (DEBUG) console.log('[DEBUG] Waiting for search to complete...')
    await new Promise((resolve) => setTimeout(resolve, 5000)) // for global/local searches, let's give amule some time for the progress to re-initialize

    while (true) {
      const elapsed = Date.now() - startTime
      if (elapsed >= timeoutMs) {
        // console.warn("[WARN] Search timed out after", elapsed, "ms");
        return this.getSearchResults?.() ?? null
      }

      const statusTags = await this._getSearchRequestStatus()
      const statusTag = statusTags.find(
        (tag) => tag.tagId === EC_TAGS.EC_TAG_SEARCH_STATUS,
      )
      const statusValue = statusTag?.humanValue

      if (
        (network == EC_SEARCH_TYPE.EC_SEARCH_KAD &&
          (statusValue === 0xffff || statusValue === 0xfffe)) ||
        (network == EC_SEARCH_TYPE.EC_SEARCH_GLOBAL &&
          (statusValue == 100 || statusValue == 0)) ||
        (network == EC_SEARCH_TYPE.EC_SEARCH_LOCAL && elapsed >= 10000) // we get no progress for local searches, but they should be fast
      ) {
        if (DEBUG) console.log('[DEBUG] Search completed.')
        break
      }

      if (DEBUG)
        console.log(`[DEBUG] Search ${network} progress: ${statusValue}`)
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    return this.getSearchResults?.() ?? null
  }

  /**
   * Cancel and delete a download.
   * @param {string} fileHash - MD4 hash of the file to cancel
   * @returns {Promise<boolean>} True if the download was cancelled successfully
   */
  async cancelDownload(fileHash) {
    return this._sendFileCommand(EC_OPCODES.EC_OP_PARTFILE_DELETE, fileHash)
  }

  /**
   * Add a download via ed2k:// link.
   * @param {string} link - ed2k:// link
   * @param {number} [categoryId=0] - Category ID to assign (0 = default)
   * @returns {Promise<boolean>} True if the link was added successfully
   */
  async addEd2kLink(link, categoryId = 0) {
    if (DEBUG)
      console.log('[DEBUG] Requesting ed2k link download ', link, '...')

    // Prepare request
    let children = [
      {
        tagId: EC_TAGS.EC_TAG_PARTFILE_CAT,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT32, // Changed from UINT8 to UINT32
        value: categoryId,
      },
    ]
    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_STRING,
        EC_TAG_TYPES.EC_TAGTYPE_STRING,
        link,
        children,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_ADD_LINK,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return this._isSuccess(response)
  }

  /**
   * Pause a download.
   * @param {string} fileHash - MD4 hash of the file to pause
   * @returns {Promise<boolean>} True if the download was paused successfully
   */
  async pauseDownload(fileHash) {
    return this._sendFileCommand(EC_OPCODES.EC_OP_PARTFILE_PAUSE, fileHash)
  }

  /**
   * Resume a paused download.
   * @param {string} fileHash - MD4 hash of the file to resume
   * @returns {Promise<boolean>} True if the download was resumed successfully
   */
  async resumeDownload(fileHash) {
    return this._sendFileCommand(EC_OPCODES.EC_OP_PARTFILE_RESUME, fileHash)
  }

  /**
   * Get aMule's configured default incoming (download) directory.
   * As per aMule source (ECSpecialMuleTags.cpp / Preferences.cpp
   * CreateCategory): thePrefs::GetIncomingDir() is the exact same value
   * aMule assigns as a newly-created category's default path — querying
   * it directly here avoids creating-then-deleting a throwaway category
   * just to read it (see createCategory.tsx for why that matters: it was
   * racing with concurrent category creation and crashing the aMule
   * daemon with an out-of-bounds vector access).
   * @returns {Promise<string|null>} The incoming directory path, or null if unavailable
   */
  async getIncomingDir() {
    if (DEBUG) console.log('[DEBUG] Requesting incoming directory...')

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_SELECT_PREFS,
        EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        EC_PREFS.EC_PREFS_DIRECTORIES,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_GET_PREFERENCES,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    const dirPrefsTag = response.tags.find(
      (t) => t.tagId === EC_TAGS.EC_TAG_PREFS_DIRECTORIES,
    )
    const incomingTag = dirPrefsTag?.children?.find(
      (t) => t.tagId === EC_TAGS.EC_TAG_DIRECTORIES_INCOMING,
    )

    return incomingTag?.humanValue ?? null
  }

  /**
   * Get all aMule categories.
   * @returns {Promise<Object[]>} Array of category objects with { id, title, path, comment, color, priority }
   */
  async getCategories() {
    if (DEBUG) console.log('[DEBUG] Requesting categories...')

    // Request preferences with categories flag (as per aMule WebServer implementation)
    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_SELECT_PREFS,
        EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        EC_PREFS.EC_PREFS_CATEGORIES,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_GET_PREFERENCES,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    // Parse response - first tag is EC_TAG_PREFS_CATEGORIES container
    return this.parseCategories(response.tags)
  }

  /**
   * Create a new category in aMule.
   * @param {string} title - Category name
   * @param {string} [path=''] - Download path for this category
   * @param {string} [comment=''] - Category comment
   * @param {number} [color=0] - Category color in RGB format (0xRRGGBB)
   * @param {number} [priority=0] - Download priority for this category
   * @returns {Promise<{ success: boolean, categoryId: number|null }>} Result with the new category ID
   */
  async createCategory(
    title,
    path = '',
    comment = '',
    color = 0,
    priority = 0,
  ) {
    if (DEBUG) console.log('[DEBUG] Creating category:', title)

    const children = [
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_TITLE,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: title,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_PATH,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: path,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_COMMENT,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: comment,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_COLOR,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        value: color, // RGB format: 0xRRGGBB
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_PRIO,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT8,
        value: priority,
      },
    ]

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_CATEGORY,
        EC_TAG_TYPES.EC_TAGTYPE_CUSTOM,
        undefined, // No value for container tag
        children,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_CREATE_CATEGORY,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    // Parse the new category ID from response
    const categoryId = this.parseCategoryIdFromResponse(response)

    // Success if we got a valid category ID back (aMule created it)
    // OR if the opcode indicates success
    const success = categoryId !== null || this._isSuccess(response)

    if (DEBUG)
      console.log(
        '[DEBUG] Category creation success:',
        success,
        'categoryId:',
        categoryId,
        'opcode:',
        response.opcode,
      )

    return {
      success: success,
      categoryId: categoryId,
    }
  }

  /**
   * Update an existing category in aMule.
   * @param {number} categoryId - Category ID to update
   * @param {string} title - Category name
   * @param {string} path - Download path
   * @param {string} comment - Category comment
   * @param {number} color - Category color in RGB format (0xRRGGBB)
   * @param {number} priority - Download priority
   * @returns {Promise<boolean>} True if the update was successful
   */
  async updateCategory(categoryId, title, path, comment, color, priority) {
    if (DEBUG) console.log('[DEBUG] Updating category:', categoryId)

    const children = [
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_TITLE,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: title,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_PATH,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: path,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_COMMENT,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_STRING,
        value: comment,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_COLOR,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        value: color,
      },
      {
        tagId: EC_TAGS.EC_TAG_CATEGORY_PRIO,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT8,
        value: priority,
      },
    ]

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_CATEGORY,
        EC_TAG_TYPES.EC_TAGTYPE_UINT32, // Category ID is uint32
        categoryId,
        children,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_UPDATE_CATEGORY,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return this._isSuccess(response)
  }

  /**
   * Delete a category from aMule.
   * @param {number} categoryId - Category ID to delete
   * @returns {Promise<boolean>} True if the deletion was successful
   */
  async deleteCategory(categoryId) {
    if (DEBUG) console.log('[DEBUG] Deleting category:', categoryId)

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_CATEGORY,
        EC_TAG_TYPES.EC_TAGTYPE_UINT32,
        categoryId,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_DELETE_CATEGORY,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return this._isSuccess(response)
  }

  /**
   * Assign a download to a category.
   * @param {string} fileHash - MD4 hash of the file
   * @param {number} categoryId - Category ID to assign
   * @returns {Promise<boolean>} True if the category was set successfully
   */
  async setFileCategory(fileHash, categoryId) {
    if (DEBUG)
      console.log('[DEBUG] Setting file category:', fileHash, '->', categoryId)

    const children = [
      {
        tagId: EC_TAGS.EC_TAG_PARTFILE_CAT,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT32, // Category ID is uint32
        value: categoryId,
      },
    ]

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_PARTFILE,
        EC_TAG_TYPES.EC_TAGTYPE_HASH16,
        fileHash,
        children,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_PARTFILE_SET_CAT,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return this._isSuccess(response)
  }

  /**
   * Set a download's queue priority.
   * As per aMule source (ExternalConn.cpp EC_OP_PARTFILE_PRIO_SET): the child
   * tag carries the raw priority value — PR_LOW=0, PR_NORMAL=1, PR_HIGH=2,
   * PR_VERYHIGH=3, PR_AUTO=5 (auto-priority based on source count/rarity).
   * @param {string} fileHash - MD4 hash of the file
   * @param {number} priority - Priority level (see values above)
   * @returns {Promise<boolean>} True if the priority was set successfully
   */
  async setDownloadPriority(fileHash, priority) {
    if (DEBUG)
      console.log(
        '[DEBUG] Setting download priority:',
        fileHash,
        '->',
        priority,
      )

    const children = [
      {
        tagId: EC_TAGS.EC_TAG_PARTFILE_PRIO,
        tagType: EC_TAG_TYPES.EC_TAGTYPE_UINT8,
        value: priority,
      },
    ]

    const reqTags = [
      this.session.createTag(
        EC_TAGS.EC_TAG_PARTFILE,
        EC_TAG_TYPES.EC_TAGTYPE_HASH16,
        fileHash,
        children,
      ),
    ]

    const response = await this.session.sendPacket(
      EC_OPCODES.EC_OP_PARTFILE_PRIO_SET,
      reqTags,
    )

    if (DEBUG) console.log('[DEBUG] Received response:', response)

    return this._isSuccess(response)
  }

  /**
   * Parse fields from an EC_TAG_PARTFILE tag (for incremental merging).
   * Only returns fields actually present in the response.
   * @param {Object} tag - Raw EC tag
   * @returns {Object} Parsed download fields
   * @private
   */
  _parseDownloadFields(tag) {
    const result = {}
    if (!tag.children) return result

    for (const sub of tag.children) {
      const val = sub.humanValue
      switch (sub.tagId) {
        case EC_TAGS.EC_TAG_PARTFILE_NAME:
          result.fileName = fixMojibake(val)
          result.rawFileName = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_HASH:
          result.fileHash = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_STATUS:
          result.status = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SIZE_FULL:
          result.fileSize = Number(val)
          break
        case EC_TAGS.EC_TAG_PARTFILE_SIZE_DONE:
          result.fileSizeDownloaded = Number(val)
          break
        case EC_TAGS.EC_TAG_PARTFILE_SPEED:
          result.speed = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SOURCE_COUNT:
          result.sourceCount = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SOURCE_COUNT_XFER:
          result.sourceCountXfer = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SOURCE_COUNT_A4AF:
          result.sourceCountA4AF = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SOURCE_COUNT_NOT_CURRENT:
          result.sourceCountNotCurrent = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_PRIO:
          result.priority = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_CAT:
          result.category = val || 0
          break
        case EC_TAGS.EC_TAG_PARTFILE_LAST_SEEN_COMP:
          result.lastSeenComplete = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_LAST_RECV:
          result.lastReceived = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_DOWNLOAD_ACTIVE:
          result.downloadActiveTime = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_ED2K_LINK:
          result.ed2kLink = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SHARED:
          result.isShared = val === 1
          break
        case EC_TAGS.EC_TAG_PARTFILE_PART_STATUS:
          result._rawPartStatus = sub.value
          break
        case EC_TAGS.EC_TAG_PARTFILE_GAP_STATUS:
          result._rawGapStatus = sub.value
          break
        case EC_TAGS.EC_TAG_PARTFILE_REQ_STATUS:
          result._rawReqStatus = sub.value
          break
        // Aggregated user rating for search results (requires aMule PR #452
        // https://github.com/amule-project/amule/pull/452). aMule builds without
        // that patch don't emit this tag and the case simply never fires.
        case EC_TAGS.EC_TAG_KNOWNFILE_RATING:
          result.rating = val || 0
          break
      }
    }

    // Calculate progress when both size fields are present
    if (
      result.fileSizeDownloaded !== undefined &&
      result.fileSize !== undefined &&
      result.fileSize > 0
    ) {
      result.progress = (
        (result.fileSizeDownloaded / result.fileSize) *
        100
      ).toFixed(2)
    }

    return result
  }

  /**
   * Reconstruct EC buffer fields (partStatus, gapStatus, reqStatus) for a download.
   * aMule's EC_OP_GET_UPDATE sends RLE-compressed XOR diffs for these fields.
   * We must: RLE-decode → XOR with previous state → store → decode to usable format.
   * @param {number} ecid - Download ECID for state tracking
   * @param {Object} fields - Parsed fields from _parseDownloadFields (may contain _raw* fields)
   * @private
   */
  _reconstructBufferFields(ecid, fields) {
    if (!this._ecBufferState) this._ecBufferState = new Map()

    const FIELDS = [
      { raw: '_rawPartStatus', out: 'partStatus', uint64: false },
      { raw: '_rawGapStatus', out: 'gapStatus', uint64: true },
      { raw: '_rawReqStatus', out: 'reqStatus', uint64: true },
    ]

    for (const { raw, out, uint64 } of FIELDS) {
      if (!fields[raw]) continue

      // Step 1: RLE-decode the incoming buffer
      const decoded = AmuleClient._decodeRLE(fields[raw])

      // Step 2: XOR-reconstruct with previous state
      // Mirrors aMule's RLE_Data exactly:
      //   1. Realloc(newSize) — resize m_buff to match incoming size
      //      (preserves overlap, zero-extends on grow, truncates on shrink)
      //   2. m_buff[k] ^= decBuf[k] — XOR diff onto resized prev
      //
      // IMPORTANT: The data is stored in column-major (interleaved) order.
      // aMule's Realloc operates on the raw interleaved bytes — it does NOT
      // de-interleave before resizing. This means on size change, the column
      // stride changes and the overlapping bytes represent different logical
      // positions. aMule's own code does this too, so we match it exactly.
      const state = this._ecBufferState.get(ecid) || {}
      const prev = state[out]
      let current
      let xorApplied = false
      if (prev) {
        // Realloc: resize prev to decoded.length (same as aMule's Realloc)
        let resized
        if (prev.length === decoded.length) {
          resized = Buffer.from(prev) // copy — don't mutate stored state
        } else if (decoded.length > prev.length) {
          // Grow: copy old data, zero-fill extension
          resized = Buffer.alloc(decoded.length, 0)
          prev.copy(resized, 0, 0, prev.length)
        } else {
          // Shrink: truncate to new size
          resized = Buffer.from(prev.subarray(0, decoded.length))
        }
        // XOR: resized[k] ^= decoded[k] (same as aMule: m_buff[k] ^= decBuf[k])
        for (let i = 0; i < decoded.length; i++) {
          resized[i] ^= decoded[i]
        }
        current = resized
        xorApplied = true
      } else {
        // First update — no previous state, decoded IS the full data
        current = decoded
      }

      if (DEBUG) {
        const nonZeroDecoded = Array.from(decoded).filter((b) => b !== 0).length
        const nonZeroCurrent = Array.from(current).filter((b) => b !== 0).length
        console.log(
          `[EC-RECONSTRUCT] ecid=${ecid} field=${out}: raw=${fields[raw].length}B → rle=${decoded.length}B → xor=${xorApplied} (prev=${prev ? prev.length + 'B' : 'none'}) → current=${current.length}B (nonzero: decoded=${nonZeroDecoded}, current=${nonZeroCurrent})`,
        )
      }

      // Step 3: Store reconstructed interleaved bytes for next XOR
      state[out] = current
      this._ecBufferState.set(ecid, state)

      // Step 4: Decode to usable format
      if (uint64) {
        fields[out] = AmuleClient._decodeInterleavedUint64Pairs(current)
      } else {
        // partStatus: each byte is a source count
        fields[out] = Array.from(current)
      }

      // Clean up raw field
      delete fields[raw]
    }
  }

  /**
   * Decode RLE-compressed buffer (aMule EC protocol format).
   * Format: [value, value, count] = repeat value count times; single values pass through.
   * @param {Buffer} buff - RLE-encoded buffer
   * @returns {Buffer} Decoded buffer
   * @static
   */
  static _decodeRLE(buff) {
    if (!buff || buff.length === 0) return Buffer.alloc(0)

    // First pass: calculate output size
    let outputSize = 0
    let i = 0
    while (i < buff.length) {
      if (i + 1 < buff.length && buff[i + 1] === buff[i]) {
        if (i + 2 < buff.length) {
          outputSize += buff[i + 2]
          i += 3
        } else {
          outputSize += 2
          i += 2
        }
      } else {
        outputSize++
        i++
      }
    }

    // Second pass: decode
    const output = Buffer.alloc(outputSize)
    let outIdx = 0
    i = 0
    while (i < buff.length) {
      if (i + 1 < buff.length && buff[i + 1] === buff[i]) {
        if (i + 2 < buff.length) {
          const val = buff[i]
          const count = buff[i + 2]
          output.fill(val, outIdx, outIdx + count)
          outIdx += count
          i += 3
        } else {
          output[outIdx++] = buff[i]
          output[outIdx++] = buff[i + 1]
          i += 2
        }
      } else {
        output[outIdx++] = buff[i]
        i++
      }
    }

    return output
  }

  /**
   * Decode interleaved column-major bytes into uint64 pairs [{start, end}].
   * aMule stores uint64 values as byte-interleaved columns for better RLE compression.
   * @param {Buffer} buf - Interleaved byte buffer
   * @returns {Array<{start: number, end: number}>} Array of range pairs
   * @static
   */
  static _decodeInterleavedUint64Pairs(buf) {
    const numValues = Math.floor(buf.length / 8)
    if (numValues === 0) return []

    const values = new Array(numValues)
    for (let i = 0; i < numValues; i++) {
      let value = 0n
      for (let j = 0; j < 8; j++) {
        const byteIdx = i + j * numValues
        if (byteIdx < buf.length) {
          // Little-endian: byte 0 is LSB, byte 7 is MSB
          value |= BigInt(buf[byteIdx]) << BigInt(j * 8)
        }
      }
      values[i] = Number(value)
    }

    // Pair up as (start, end) ranges
    const ranges = []
    for (let i = 0; i < values.length; i += 2) {
      if (i + 1 < values.length) {
        ranges.push({ start: values[i], end: values[i + 1] })
      }
    }
    return ranges
  }

  /**
   * Parse fields from an EC_TAG_KNOWNFILE tag (for incremental merging).
   * Only returns fields actually present in the response.
   * @param {Object} tag - Raw EC tag
   * @returns {{fileName: string, fileHash: string, fileSize: number, transferred: number, transferredTotal: number, reqCount: number, reqCountTotal: number, acceptedCount: number, acceptedCountTotal: number, priority: number, path: string, completeSources: number, onQueue: number, ed2kLink: string, comment: string, rating: number}[]} Parsed shared file fields
   * @private
   */
  _parseSharedFileFields(tag) {
    const result = {}
    if (!tag.children) return result

    for (const sub of tag.children) {
      const val = sub.humanValue
      switch (sub.tagId) {
        case EC_TAGS.EC_TAG_PARTFILE_NAME:
          result.fileName = fixMojibake(val)
          result.rawFileName = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_HASH:
          result.fileHash = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_SIZE_FULL:
          result.fileSize = Number(val)
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_XFERRED:
          result.transferred = Number(val)
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_XFERRED_ALL:
          result.transferredTotal = Number(val)
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_REQ_COUNT:
          result.reqCount = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_REQ_COUNT_ALL:
          result.reqCountTotal = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_ACCEPT_COUNT:
          result.acceptedCount = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_ACCEPT_COUNT_ALL:
          result.acceptedCountTotal = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_PRIO:
          result.priority = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_FILENAME:
          result.path = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_COMPLETE_SOURCES:
          result.completeSources = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_ON_QUEUE:
          result.onQueue = val
          break
        case EC_TAGS.EC_TAG_PARTFILE_ED2K_LINK:
          result.ed2kLink = val
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_COMMENT:
          result.comment = val || ''
          break
        case EC_TAGS.EC_TAG_KNOWNFILE_RATING:
          result.rating = val || 0
          break
      }
    }

    return result
  }

  /**
   * Parse category tags from an EC_OP_GET_PREFERENCES response.
   * @param {Object[]} tags - Raw response tags
   * @returns {Object[]} Array of category objects with { id, title, path, comment, color, priority }
   */
  parseCategories(tags) {
    // As per aMule source: first tag is EC_TAG_PREFS_CATEGORIES container
    const prefsTag = tags[0]

    // Check if we have any tags at all (empty response means no categories)
    if (!tags || tags.length === 0) {
      return []
    }

    // Check if it's the categories tag
    if (!prefsTag || prefsTag.tagId !== EC_TAGS.EC_TAG_PREFS_CATEGORIES) {
      if (DEBUG)
        console.warn(
          'Expected EC_TAG_PREFS_CATEGORIES but got:',
          prefsTag?.tagId,
        )
      return []
    }

    if (!prefsTag.children || prefsTag.children.length === 0) {
      return [] // No categories defined
    }

    // Each child is EC_TAG_CATEGORY with ID as value and properties as children
    return prefsTag.children
      .filter((t) => t.tagId === EC_TAGS.EC_TAG_CATEGORY)
      .map((catTag, index) => {
        // Category ID from tag value - handle both Buffer and number types.
        // Use ?? rather than || : category 0 ("no category"/default) is a valid,
        // falsy ID and must not be treated as "missing" and overwritten by the
        // Buffer or array-index fallback.
        let id = catTag.humanValue ?? catTag.value ?? index
        if (Buffer.isBuffer(id)) {
          id = id.readUInt8(0) // Convert Buffer to number
        }

        const title =
          catTag.children?.find(
            (c) => c.tagId === EC_TAGS.EC_TAG_CATEGORY_TITLE,
          )?.humanValue || ''
        const path =
          catTag.children?.find((c) => c.tagId === EC_TAGS.EC_TAG_CATEGORY_PATH)
            ?.humanValue || ''
        const comment =
          catTag.children?.find(
            (c) => c.tagId === EC_TAGS.EC_TAG_CATEGORY_COMMENT,
          )?.humanValue || ''
        const color =
          catTag.children?.find(
            (c) => c.tagId === EC_TAGS.EC_TAG_CATEGORY_COLOR,
          )?.humanValue || 0
        const priority =
          catTag.children?.find((c) => c.tagId === EC_TAGS.EC_TAG_CATEGORY_PRIO)
            ?.humanValue || 0

        return { id, title, path, comment, color, priority }
      })
  }

  /**
   * Extract the new category ID from an EC_OP_CREATE_CATEGORY response.
   * @param {Object} response - Raw EC response
   * @returns {number|null} The new category ID, or null if not found
   */
  parseCategoryIdFromResponse(response) {
    const categoryTag = response.tags?.find(
      (t) => t.tagId === EC_TAGS.EC_TAG_CATEGORY,
    )
    // ?? rather than ||, same reasoning as parseCategories: a returned ID of 0 is
    // valid and must not be treated as absent.
    return categoryTag?.humanValue ?? categoryTag?.value ?? null
  }

  /**
   * Format a raw EC value into a human-readable string.
   * @param {*} value - Raw value to format
   * @param {number} type - EC_VALUE_TYPE constant
   * @returns {string|*} Formatted string or original value
   */
  formatValue(value, type) {
    if (value === undefined || value === null) return value

    switch (type) {
      case EC_VALUE_TYPE.EC_VALUE_BYTES: {
        // Convert bytes to human-readable format
        const num = typeof value === 'string' ? BigInt(value) : BigInt(value)
        const bytes = Number(num)

        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
        if (bytes < 1024 * 1024 * 1024)
          return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
      }

      case EC_VALUE_TYPE.EC_VALUE_SPEED: {
        // Convert bytes/s to KB/s
        const kbps = value / 1024
        return `${kbps.toFixed(2)} KB/s`
      }

      case EC_VALUE_TYPE.EC_VALUE_TIME: {
        // Convert seconds to days + hours + minutes
        const seconds = Number(value)
        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = seconds % 60

        const parts = []
        if (days > 0) parts.push(`${days}d`)
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}m`)
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

        return parts.join(' ')
      }

      case EC_VALUE_TYPE.EC_VALUE_DOUBLE:
        return typeof value === 'number' ? value.toFixed(2) : value

      case EC_VALUE_TYPE.EC_VALUE_INTEGER:
      case EC_VALUE_TYPE.EC_VALUE_ISTRING:
      case EC_VALUE_TYPE.EC_VALUE_ISHORT:
      case EC_VALUE_TYPE.EC_VALUE_STRING:
      default:
        return value
    }
  }

  /**
   * Build a nested JS object tree from raw EC tags.
   * Handles duplicate keys by converting to arrays, and attaches
   * formatted values via EC_TAG_STAT_VALUE_TYPE children.
   * @param {Object[]} tags - Array of raw EC tags
   * @returns {Object} Nested object tree keyed by tag name strings
   */
  buildTagTree(tags) {
    const obj = {}

    for (const tag of tags) {
      // Skip EC_TAG_STATTREE_NODEID - not needed in output
      if (tag.tagIdStr === 'EC_TAG_STATTREE_NODEID') continue

      // Check if this tag has a value type specified in children
      let valueType = null
      let formattedValue = tag.humanValue

      if (tag.children && tag.children.length > 0) {
        const valueTypeTag = tag.children.find(
          (child) => child.tagIdStr === 'EC_TAG_STAT_VALUE_TYPE',
        )
        if (valueTypeTag) {
          valueType = valueTypeTag.humanValue
          formattedValue = this.formatValue(tag.humanValue, valueType)
        }
      }

      // Recursively build children (excluding EC_TAG_STAT_VALUE_TYPE and EC_TAG_STATTREE_NODEID)
      const childrenObj =
        tag.children && tag.children.length > 0
          ? this.buildTagTree(
              tag.children.filter(
                (child) =>
                  child.tagIdStr !== 'EC_TAG_STAT_VALUE_TYPE' &&
                  child.tagIdStr !== 'EC_TAG_STATTREE_NODEID',
              ),
            )
          : null

      // Determine the node structure based on what we have
      let node
      if (childrenObj && Object.keys(childrenObj).length > 0) {
        // Has children - create object with value (if meaningful) and spread children
        if (
          formattedValue !== undefined &&
          formattedValue !== null &&
          formattedValue !== ''
        ) {
          node = { _value: formattedValue, ...childrenObj }
        } else {
          node = childrenObj
        }
      } else {
        // No children - just use the formatted value directly
        node = formattedValue
      }

      // Handle duplicate keys by converting to array
      if (obj.hasOwnProperty(tag.tagIdStr)) {
        if (!Array.isArray(obj[tag.tagIdStr])) {
          obj[tag.tagIdStr] = [obj[tag.tagIdStr]]
        }
        obj[tag.tagIdStr].push(node)
      } else {
        obj[tag.tagIdStr] = node
      }
    }

    return obj
  }
}

export default AmuleClient
