import { describe, expect, it } from 'vitest'
import { fromMagnetLink, toMagnetLink } from './links'

const ED2K_HASH = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'

describe('toMagnetLink', () => {
  it('generates aMulerr synthetic btih magnets', () => {
    const magnet = toMagnetLink(ED2K_HASH, 'Test Book', 12345)
    expect(magnet).not.toBeNull()
  })

  it('rejects invalid ed2k hashes', () => {
    const magnet = toMagnetLink('not-a-hash', 'book.pdf', 100)
    expect(magnet).toBeNull()
  })
})

describe('fromMagnetLink', () => {
  it('round-trips a synthetic magnet', () => {
    const magnet = toMagnetLink(ED2K_HASH, 'Test Book', 12345)!
    expect(fromMagnetLink(magnet)).toEqual({
      hash: ED2K_HASH,
      name: 'Test Book',
      size: 12345,
    })
  })

  it('parses parameters regardless of order or extra params', () => {
    const magnet = toMagnetLink(ED2K_HASH, 'Movie 2020', 42)!
    const btih = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('xt')!
    const reordered = `magnet:?xl=42&x.pe=1.2.3.4&dn=${encodeURIComponent('Movie 2020')}&xt=${btih}`

    expect(fromMagnetLink(reordered)).toEqual({
      hash: ED2K_HASH,
      name: 'Movie 2020',
      size: 42,
    })
  })

  it('accepts a btih already normalised to 40 hex chars', () => {
    const reordered = `magnet:?xt=urn:btih:${ED2K_HASH}00000000&dn=x&xl=1`
    expect(fromMagnetLink(reordered).hash).toBe(ED2K_HASH)
  })

  it('throws on a magnet without a btih', () => {
    expect(() => fromMagnetLink('magnet:?dn=x&xl=1')).toThrow()
  })
})
