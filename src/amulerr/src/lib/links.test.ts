import { describe, expect, it } from 'vitest'
import {
  btihToEd2kHash,
  clientHashToEd2kHash,
  ed2kHashToClientHash,
  fromMagnetLink,
  toMagnetLink,
} from './links'

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
    const name = encodeURIComponent('Movie 2020')
    const reordered = `magnet:?xl=42&x.pe=1.2.3.4&dn=${name}&xt=urn:btih:${ED2K_HASH}00000000`
    expect(fromMagnetLink(reordered)).toEqual({
      hash: ED2K_HASH,
      name: 'Movie 2020',
      size: 42,
    })
  })

  it('throws when the magnet has no btih', () => {
    expect(() => fromMagnetLink('magnet:?dn=x&xl=1')).toThrow()
  })
})

describe('btihToEd2kHash', () => {
  it('reads a 40 hex char (zero-padded) btih', () => {
    expect(btihToEd2kHash(`${ED2K_HASH}00000000`)).toBe(ED2K_HASH)
  })

  it('returns null for a value that is neither base32 nor hex', () => {
    expect(btihToEd2kHash('not a hash')).toBeNull()
  })
})

describe('client hash <-> ed2k hash', () => {
  it('pads the ed2k hash to 40 chars for download clients', () => {
    expect(ed2kHashToClientHash(ED2K_HASH)).toBe(`${ED2K_HASH}00000000`)
  })

  it('strips the padding back off', () => {
    expect(clientHashToEd2kHash(`${ED2K_HASH}00000000`)).toBe(ED2K_HASH)
  })

  it('leaves a bare 32 char ed2k hash untouched', () => {
    expect(clientHashToEd2kHash(ED2K_HASH.toLowerCase())).toBe(ED2K_HASH)
  })
})
