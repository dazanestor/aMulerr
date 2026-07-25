import { describe, expect, it } from 'vitest'
import { itemsResponse } from './indexer'
import { toMagnetLink } from './links'

const ED2K = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'

describe('itemsResponse', () => {
  it('skips search results with invalid hashes instead of failing the feed', () => {
    const xml = itemsResponse(
      [
        { fileName: 'good.pdf', fileHash: ED2K, fileSize: 100, sourceCount: 3 },
        {
          fileName: 'bad.pdf',
          fileHash: 'not-a-hash',
          fileSize: 50,
          sourceCount: 1,
        },
      ],
      [7000],
    )

    expect(xml).toContain('total="1"')
    expect(xml).toContain('good.pdf')
    expect(xml).not.toContain('bad.pdf')
  })

  it('includes link, enclosure, and magneturl for valid results', () => {
    const xml = itemsResponse(
      [{ fileName: 'book.pdf', fileHash: ED2K, fileSize: 100, sourceCount: 1 }],
      [7000],
    )

    // The magnet's btih is base32 (per toMagnetLink / BEP-9), not the raw hex
    // hash — derive the expected value the same way instead of hardcoding a
    // guessed hex string that doesn't match the real encoding.
    const expectedMagnet = toMagnetLink(ED2K, 'book.pdf', 100)

    expect(xml).toContain('<link>')
    expect(xml).toContain('<enclosure url=')
    expect(xml).toContain('torznab:attr name="magneturl"')
    expect(expectedMagnet).not.toBeNull()
    expect(xml).toContain(expectedMagnet!.split('urn:btih:')[1]!.split('&')[0])
  })
})
