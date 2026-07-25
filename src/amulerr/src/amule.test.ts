import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientMock = {
  connect: vi.fn(),
  close: vi.fn(),
}

vi.mock('#/amule-ec-node/AmuleClient.mjs', () => ({
  // Arrow functions can't be used as constructors — `new AmuleClient(...)`
  // in amule.ts requires this mock to actually be constructable.
  default: vi.fn(function AmuleClientMock() {
    return clientMock
  }),
}))

describe('useAmule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.connect.mockResolvedValue(undefined)
    process.env.AMULE_HOST = 'gluetun'
    process.env.AMULE_PORT = '4712'
    process.env.AMULE_PWD = 'secret'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the callback result and always closes the client', async () => {
    const { useAmule } = await import('#/amule')

    const result = await useAmule(async () => 'ok')

    expect(result).toBe('ok')
    expect(clientMock.close).toHaveBeenCalledTimes(1)
  })

  // Regression test: a real /torrents/delete call once failed with a bare
  // "500 unhandled" in Radarr's log and nothing on our side to diagnose it
  // with (Radarr's own retry eventually got it through, so it was a
  // transient EC hiccup, not a logic bug — but there was no way to tell
  // that from our logs at the time). useAmule now logs before rethrowing.
  it('logs the error before rethrowing, and still closes the client', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { useAmule } = await import('#/amule')
    const failure = new Error('Request timed out after 30000ms')

    await expect(
      useAmule(async () => {
        throw failure
      }),
    ).rejects.toThrow(failure)

    expect(consoleError).toHaveBeenCalledWith(
      '[useAmule] aMule operation failed:',
      failure,
    )
    expect(clientMock.close).toHaveBeenCalledTimes(1)
  })
})
