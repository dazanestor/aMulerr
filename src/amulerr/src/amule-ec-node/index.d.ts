declare module '#/amule-ec-node/AmuleClient.mjs' {
  export type AmuleTagTree = {
    EC_TAG_STATS_ED2K_USERS: number
    EC_TAG_STATS_KAD_USERS: number
    EC_TAG_CONNSTATE: {
      EC_TAG_ED2K_ID: number
      EC_TAG_CLIENT_ID: number
      EC_TAG_KAD_ID: string
    }
  }

  export interface AmuleClientOptions {
    requestTimeout?: number
  }

  export interface SharedFile {
    ecid?: number
    fileName?: string
    rawFileName?: string
    fileHash?: string
    fileSize?: number
    transferred?: number
    transferredTotal?: number
    reqCount?: number
    reqCountTotal?: number
    acceptedCount?: number
    acceptedCountTotal?: number
    priority?: number
    path?: string
    completeSources?: number
    onQueue?: number
    ed2kLink?: string
    comment?: string
    rating?: number
    raw?: AmuleTagTree
  }

  export interface DownloadItem {
    ecid?: number
    fileName: string
    fileHash: string
    fileSize: number
    ed2kLink?: string
    fileSizeDownloaded?: number
    speed?: number
    rating?: number
    status?: number
    sourceCount?: number
    sourceCountNotCurrent?: number
    sourceCountXfer?: number
    sourceCountA4AF?: number
    lastSeenComplete?: number
    lastReceived?: number
    downloadActiveTime?: number
    category?: number
    progress?: string
    raw?: AmuleTagTree
  }

  export interface AmuleClientPeer {
    ecid?: number
    userName?: string
    software?: string
    fileHash?: string
    [key: string]: unknown
  }

  export interface SearchResults {
    resultsLength: number
    results: DownloadItem[]
  }

  export interface Category {
    id: number
    title: string
    path: string
    comment: string
    color: number
    priority: number
  }

  export interface CategoryCreateResult {
    success: boolean
    categoryId: number | null
  }

  export interface RenameResult {
    success: boolean
    error?: string
  }

  export interface ConnectionPreferences {
    slotAllocation?: number
    maxDownload?: number
    maxUpload?: number
    dlCapacity?: number
    ulCapacity?: number
    tcpPort?: number
    udpPort?: number
    udpDisabled?: boolean
    maxConnections?: number
    autoConnect?: boolean
    ed2kEnabled?: boolean
    kadEnabled?: boolean
  }

  export interface UpdateSnapshot {
    downloads: DownloadItem[]
    sharedFiles: SharedFile[]
    clients: AmuleClientPeer[]
  }

  export default class AmuleClient {
    constructor(
      host: string,
      port: number,
      password: string,
      options?: AmuleClientOptions,
    )

    connect(): Promise<void>
    close(): void

    getConnectionState(): Promise<AmuleTagTree>
    getStats(): Promise<AmuleTagTree>
    getStatsTree(): Promise<AmuleTagTree>
    getServerInfo(): Promise<AmuleTagTree>
    getLog(): Promise<AmuleTagTree>
    getDebugLog(): Promise<AmuleTagTree>
    getServerList(): Promise<AmuleTagTree>
    getUploadingQueue(): Promise<AmuleTagTree>

    removeServer(ip: string, port: number): Promise<boolean>
    connectServer(ip: string, port: number): Promise<boolean>
    disconnectServer(ip: string, port: number): Promise<boolean>

    getSharedFiles(): Promise<SharedFile[]>
    clearCompleted(
      ecids?: number[],
    ): Promise<{ opcode: number; cleared: number[] }>
    refreshSharedFiles(): Promise<boolean>
    getDownloadQueue(): Promise<DownloadItem[]>
    getUpdate(): Promise<UpdateSnapshot>

    getSearchResults(): Promise<SearchResults>
    searchAndWaitResults(opts: {
      query: string
      network: 'global' | 'local' | 'kad' | number
      timeoutMs?: number
      extension?: string
    }): Promise<SearchResults | null>
    downloadSearchResult(
      fileHash: string,
      categoryId?: number,
    ): Promise<boolean>
    cancelDownload(fileHash: string): Promise<boolean>
    addEd2kLink(link: string, categoryId?: number): Promise<boolean>
    pauseDownload(fileHash: string): Promise<boolean>
    resumeDownload(fileHash: string): Promise<boolean>

    getCategories(): Promise<Category[]>
    createCategory(
      title: string,
      path?: string,
      comment?: string,
      color?: number,
      priority?: number,
    ): Promise<CategoryCreateResult>
    updateCategory(
      categoryId: number,
      title: string,
      path?: string,
      comment?: string,
      color?: number,
      priority?: number,
    ): Promise<boolean>
    deleteCategory(categoryId: number): Promise<boolean>
    setFileCategory(fileHash: string, categoryId: number): Promise<boolean>
    setDownloadPriority(fileHash: string, priority: number): Promise<boolean>

    renameFile(fileHash: string, newName: string): Promise<RenameResult>
    setFileRatingComment(
      fileHash: string,
      comment: string,
      rating: number,
    ): Promise<boolean>

    getConnectionPreferences(): Promise<ConnectionPreferences>
    setConnectionPreferences(
      prefs: Partial<ConnectionPreferences>,
    ): Promise<boolean>

    buildTagTree(tags: unknown[]): AmuleTagTree
    parseCategories(tags: unknown[]): Category[]
  }
}
