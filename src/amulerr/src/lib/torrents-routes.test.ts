import { beforeEach, describe, expect, it, vi } from 'vitest'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { toMagnetLink } from '#/lib/links'

// These route handlers all go through useAmule() to reach the real
// AmuleClient/EC connection. Replacing it with a fake client lets us assert
// on exactly what each route asks aMule to do, without a live server —
// this is the same class of bug this session kept finding (deleteFiles
// ignored, ecid never populated, eta as a float, the createCategory
// dummy-category race) that had zero test coverage before.
const amuleMock = {
  getDownloadQueue: vi.fn(),
  getSharedFiles: vi.fn(),
  getCategories: vi.fn(),
  cancelDownload: vi.fn(),
  clearCompleted: vi.fn(),
  resumeDownload: vi.fn(),
  pauseDownload: vi.fn(),
  setDownloadPriority: vi.fn(),
  setFileCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getIncomingDir: vi.fn(),
  refreshSharedFiles: vi.fn(),
  addEd2kLink: vi.fn(),
}

vi.mock('#/amule', () => ({
  useAmule: (fn: (amule: typeof amuleMock) => unknown) => fn(amuleMock),
}))

type RouteHandler = (ctx: { request: Request }) => Promise<Response>

// Same helper as qbittorrent-app-auth.test.ts — TanStack's real Route type
// is a deeply generic type parameterized by the whole route tree; matching
// it exactly here would fight the type system for no benefit in a test
// helper that only needs the runtime shape below.
function getHandler(route: unknown, method: 'GET' | 'POST' = 'GET') {
  const handler = (
    route as {
      options?: {
        server?: { handlers?: { GET?: RouteHandler; POST?: RouteHandler } }
      }
    }
  ).options?.server?.handlers?.[method]
  if (!handler) {
    throw new Error(`Missing ${method} handler`)
  }
  return handler
}

function postForm(body: Record<string, string>) {
  return new Request('http://x', {
    method: 'POST',
    body: new URLSearchParams(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  amuleMock.getCategories.mockResolvedValue([])
  amuleMock.getDownloadQueue.mockResolvedValue([])
  amuleMock.getSharedFiles.mockResolvedValue([])
})

describe('torrents/setShareLimits', () => {
  it('accepts the request without touching amule (no per-torrent seed enforcement exists)', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.setShareLimits')
    const response = await getHandler(
      Route,
      'POST',
    )({
      request: postForm({
        hashes: 'ABC',
        ratioLimit: '-2',
        seedingTimeLimit: '-2',
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Ok')
  })
})

describe('torrents/addTags', () => {
  it('accepts the request without touching amule (aMule has no multi-tag concept)', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.addTags')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'ABC', tags: 'x' }) })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Ok')
  })
})

describe('torrents/setForceStart', () => {
  it('does nothing when value=false', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.setForceStart')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc', value: 'false' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.resumeDownload).not.toHaveBeenCalled()
  })

  it('resumes every requested hash when value=true', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.setForceStart')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc|def', value: 'true' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.resumeDownload).toHaveBeenCalledTimes(2)
    expect(amuleMock.resumeDownload).toHaveBeenCalledWith('ABC')
    expect(amuleMock.resumeDownload).toHaveBeenCalledWith('DEF')
  })
})

describe('torrents/topPrio', () => {
  it('does nothing when no hashes are provided', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.topPrio')
    const response = await getHandler(Route, 'POST')({ request: postForm({}) })

    expect(response.status).toBe(200)
    expect(amuleMock.setDownloadPriority).not.toHaveBeenCalled()
  })

  it('sets PR_VERYHIGH (3) for every requested hash', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.topPrio')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc|def' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.setDownloadPriority).toHaveBeenCalledWith('ABC', 3)
    expect(amuleMock.setDownloadPriority).toHaveBeenCalledWith('DEF', 3)
  })
})

describe('torrents/properties', () => {
  it('returns 404 when hash is missing', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.properties')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/properties'),
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 when the hash matches nothing', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.properties')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/properties?hash=ABC'),
    })

    expect(response.status).toBe(404)
  })

  it('reports save_path from the matching category for an active download', async () => {
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 1,
        title: 'radarr-amule',
        path: '/downloads/incoming/radarr-amule',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.getDownloadQueue.mockResolvedValue([
      { fileHash: 'ABC', category: 1 },
    ])

    const { Route } = await import('#/routes/api.v2.torrents.properties')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/properties?hash=abc'),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.save_path).toBe('/downloads/incoming/radarr-amule')
    expect(body.seeding_time).toBe(0)
  })
})

describe('torrents/createCategory', () => {
  it('creates a new category from getIncomingDir, without creating or deleting any dummy category', async () => {
    amuleMock.getIncomingDir.mockResolvedValue('/downloads/incoming')
    amuleMock.createCategory.mockResolvedValue({ success: true, categoryId: 1 })

    const { Route } = await import('#/routes/api.v2.torrents.createCategory')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ category: 'radarr-amule' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.getIncomingDir).toHaveBeenCalled()
    expect(amuleMock.createCategory).toHaveBeenCalledExactlyOnceWith(
      'radarr-amule',
      '/downloads/incoming/radarr-amule',
      'amulerr',
    )
    expect(amuleMock.deleteCategory).not.toHaveBeenCalled()
  })

  it('fails loudly instead of building a "null/category" path when getIncomingDir is unavailable', async () => {
    amuleMock.getIncomingDir.mockResolvedValue(null)

    const { Route } = await import('#/routes/api.v2.torrents.createCategory')
    await expect(
      getHandler(
        Route,
        'POST',
      )({ request: postForm({ category: 'radarr-amule' }) }),
    ).rejects.toThrow(/incoming directory/i)

    expect(amuleMock.createCategory).not.toHaveBeenCalled()
    expect(amuleMock.updateCategory).not.toHaveBeenCalled()
  })

  it('updates an existing category instead of creating a duplicate', async () => {
    amuleMock.getIncomingDir.mockResolvedValue('/downloads/incoming')
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 1,
        title: 'radarr-amule',
        path: '/some/old/path',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.updateCategory.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.createCategory')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ category: 'radarr-amule' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.updateCategory).toHaveBeenCalledExactlyOnceWith(
      1,
      'radarr-amule',
      '/downloads/incoming/radarr-amule',
      'amulerr',
    )
    expect(amuleMock.createCategory).not.toHaveBeenCalled()
  })
})

describe('torrents/setCategory', () => {
  // Regression test: category id 0 (e.g. the very first category ever
  // created) is a real, valid id — a falsy check on it must not be
  // mistaken for "category not found", or setCategory would be permanently
  // broken for that category.
  it('accepts a category whose id is 0', async () => {
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 0,
        title: 'radarr-amule',
        path: '/downloads/incoming/radarr-amule',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.setFileCategory.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.setCategory')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc', category: 'radarr-amule' }) })

    expect(response.status).toBe(200)
    expect(amuleMock.setFileCategory).toHaveBeenCalledWith('ABC', 0)
  })

  it('fails when the category is genuinely not found', async () => {
    amuleMock.getCategories.mockResolvedValue([])

    const { Route } = await import('#/routes/api.v2.torrents.setCategory')
    await expect(
      getHandler(
        Route,
        'POST',
      )({ request: postForm({ hashes: 'abc', category: 'missing' }) }),
    ).rejects.toThrow(/not found/i)

    expect(amuleMock.setFileCategory).not.toHaveBeenCalled()
  })
})

describe('torrents/add', () => {
  const magnetLink = toMagnetLink(
    '00000000000000000000000000000001',
    'movie.mkv',
    1000,
  )!

  // Same regression as setCategory: category id 0 must be accepted, not
  // treated as "not found".
  it('accepts a category whose id is 0', async () => {
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 0,
        title: 'radarr-amule',
        path: '/downloads/incoming/radarr-amule',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.addEd2kLink.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.add')
    const response = await getHandler(
      Route,
      'POST',
    )({
      request: postForm({ urls: magnetLink, category: 'radarr-amule' }),
    })

    expect(response.status).toBe(200)
    expect(amuleMock.addEd2kLink).toHaveBeenCalledWith(expect.any(String), 0)
  })

  it('fails when the category is genuinely not found', async () => {
    amuleMock.getCategories.mockResolvedValue([])

    const { Route } = await import('#/routes/api.v2.torrents.add')
    await expect(
      getHandler(
        Route,
        'POST',
      )({
        request: postForm({ urls: magnetLink, category: 'missing' }),
      }),
    ).rejects.toThrow(/not found/i)

    expect(amuleMock.addEd2kLink).not.toHaveBeenCalled()
  })
})

describe('torrents/delete', () => {
  function withTempFile() {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'amulerr-test-'))
    const fileName = 'movie.mkv'
    fsSync.writeFileSync(path.join(dir, fileName), 'fake content')
    return { dir, fileName, fullPath: path.join(dir, fileName) }
  }

  it('does NOT delete the physical file when deleteFiles=false', async () => {
    const { dir, fileName, fullPath } = withTempFile()
    amuleMock.getSharedFiles.mockResolvedValue([
      { fileHash: 'ABC', ecid: 5, path: dir, fileName },
    ])
    amuleMock.clearCompleted.mockResolvedValue({ opcode: 1, cleared: [5] })
    amuleMock.cancelDownload.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.delete')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc', deleteFiles: 'false' }) })

    expect(response.status).toBe(200)
    expect(fsSync.existsSync(fullPath)).toBe(true)
    expect(amuleMock.refreshSharedFiles).not.toHaveBeenCalled()

    fsSync.rmSync(dir, { recursive: true, force: true })
  })

  it('deletes the physical file when deleteFiles is omitted (defaults to true)', async () => {
    const { dir, fileName, fullPath } = withTempFile()
    amuleMock.getSharedFiles.mockResolvedValue([
      { fileHash: 'ABC', ecid: 5, path: dir, fileName },
    ])
    amuleMock.clearCompleted.mockResolvedValue({ opcode: 1, cleared: [5] })
    amuleMock.cancelDownload.mockResolvedValue(true)
    amuleMock.refreshSharedFiles.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.delete')
    const response = await getHandler(
      Route,
      'POST',
    )({ request: postForm({ hashes: 'abc' }) })

    expect(response.status).toBe(200)
    expect(fsSync.existsSync(fullPath)).toBe(false)
    expect(amuleMock.refreshSharedFiles).toHaveBeenCalled()

    fsSync.rmSync(dir, { recursive: true, force: true })
  })

  it("passes the matched shared files' real ecids to clearCompleted", async () => {
    const { dir, fileName } = withTempFile()
    amuleMock.getSharedFiles.mockResolvedValue([
      { fileHash: 'ABC', ecid: 5, path: dir, fileName },
    ])
    amuleMock.clearCompleted.mockResolvedValue({ opcode: 1, cleared: [5] })
    amuleMock.cancelDownload.mockResolvedValue(true)
    amuleMock.refreshSharedFiles.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.delete')
    await getHandler(Route, 'POST')({ request: postForm({ hashes: 'abc' }) })

    expect(amuleMock.clearCompleted).toHaveBeenCalledWith([5])

    fsSync.rmSync(dir, { recursive: true, force: true })
  })

  // Regression test: an ecid of 0 is a valid identifier (see
  // AmuleClient.mjs's getSharedFiles) — a falsy filter on it would silently
  // drop that file from clearCompleted, leaving a stale "known" entry in
  // aMule pointing at data that was just physically deleted.
  it('still passes an ecid of 0 through to clearCompleted', async () => {
    const { dir, fileName } = withTempFile()
    amuleMock.getSharedFiles.mockResolvedValue([
      { fileHash: 'ABC', ecid: 0, path: dir, fileName },
    ])
    amuleMock.clearCompleted.mockResolvedValue({ opcode: 1, cleared: [0] })
    amuleMock.cancelDownload.mockResolvedValue(true)
    amuleMock.refreshSharedFiles.mockResolvedValue(true)

    const { Route } = await import('#/routes/api.v2.torrents.delete')
    await getHandler(Route, 'POST')({ request: postForm({ hashes: 'abc' }) })

    expect(amuleMock.clearCompleted).toHaveBeenCalledWith([0])

    fsSync.rmSync(dir, { recursive: true, force: true })
  })
})

describe('torrents/info', () => {
  it('always reports eta as a whole number', async () => {
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 1,
        title: 'radarr-amule',
        path: '/downloads/incoming/radarr-amule',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.getDownloadQueue.mockResolvedValue([
      {
        fileHash: 'ABC',
        fileName: 'movie.mkv',
        fileSize: 1000,
        fileSizeDownloaded: 333,
        speed: 7, // (1000 - 333) / 7 = 95.28... — must be floored
        category: 1,
        status: 1,
        progress: '33.30',
      },
    ])

    const { Route } = await import('#/routes/api.v2.torrents.info')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/info'),
    })
    const body = await response.json()

    expect(Number.isInteger(body[0].eta)).toBe(true)
    expect(body[0].eta).toBe(95)
  })

  it('reports a reached seeding-time limit so Radarr/Sonarr can Move (not Copy) and auto-remove completed downloads', async () => {
    amuleMock.getCategories.mockResolvedValue([
      {
        id: 1,
        title: 'radarr-amule',
        path: '/downloads/incoming/radarr-amule',
        comment: 'amulerr',
        color: 0,
        priority: 0,
      },
    ])
    amuleMock.getDownloadQueue.mockResolvedValue([
      {
        fileHash: 'ABC',
        fileName: 'movie.mkv',
        fileSize: 1000,
        fileSizeDownloaded: 1000,
        speed: 0,
        category: 1,
        status: 9,
        progress: '100.00',
        downloadActiveTime: 42,
      },
    ])

    const { Route } = await import('#/routes/api.v2.torrents.info')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/info'),
    })
    const body = await response.json()

    expect(body[0].seeding_time_limit).toBe(0)
    expect(body[0].seeding_time).toBe(42)
  })

  const HASH_A = 'A'.repeat(32)
  const HASH_B = 'B'.repeat(32)

  it('reports the hash as the 40 hex char (zero-padded) client form', async () => {
    amuleMock.getDownloadQueue.mockResolvedValue([
      { fileHash: HASH_A, fileName: 'movie.mkv', fileSize: 1, status: 1 },
    ])

    const { Route } = await import('#/routes/api.v2.torrents.info')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/info'),
    })
    const body = await response.json()

    expect(body[0].hash).toBe(`${HASH_A}00000000`)
  })

  it('filters by the ?hashes= param (Cleanuparr fetches one torrent at a time)', async () => {
    amuleMock.getDownloadQueue.mockResolvedValue([
      { fileHash: HASH_A, fileName: 'a.mkv', fileSize: 1, status: 1 },
      { fileHash: HASH_B, fileName: 'b.mkv', fileSize: 1, status: 1 },
    ])

    const { Route } = await import('#/routes/api.v2.torrents.info')
    const response = await getHandler(Route)({
      request: new Request(
        `http://x/api/v2/torrents/info?hashes=${HASH_B}00000000`,
      ),
    })
    const body = await response.json()

    expect(body).toHaveLength(1)
    expect(body[0].hash).toBe(`${HASH_B}00000000`)
  })
})

describe('torrents/trackers', () => {
  it('returns an empty tracker list (ed2k downloads have no BitTorrent trackers)', async () => {
    const { Route } = await import('#/routes/api.v2.torrents.trackers')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/torrents/trackers?hash=ABC'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

describe('transfer/speedLimitsMode', () => {
  it('reports alternative speed limits as off', async () => {
    const { Route } = await import('#/routes/api.v2.transfer.speedLimitsMode')
    const response = await getHandler(Route)({
      request: new Request('http://x/api/v2/transfer/speedLimitsMode'),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0')
  })
})
