import { skipFalsy } from './array'
import { encode } from 'html-entities'
import { buildRFC822Date } from './time'
import type { searchAll } from '#/amule'
import { ed2kHashToClientHash, toMagnetLink } from './links'

export const fakeItem = {
  fileName: 'FAKE',
  fileHash: '00000000000000000000000000000000',
  fileSize: 1,
  sourceCount: 1,
} satisfies Awaited<ReturnType<typeof searchAll>>[number]

export const emptyResponse = (offset: string) => `
  <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
    <channel>
      <torznab:response offset="${offset}" total="0"/>
    </channel>
  </rss>`

export const itemsResponse = (
  searchResults: Awaited<ReturnType<typeof searchAll>>,
  categories: number[],
) => {
  // Build items first so `total` reflects what's actually rendered — items whose
  // hash fails validation (toMagnetLink returns null) are dropped and must not be
  // counted, or Torznab consumers see a `total` higher than the <item> count.
  const items = searchResults
    .map((item) => {
      const magnetLink = toMagnetLink(
        item.fileHash,
        item.fileName,
        item.fileSize,
      )

      if (!magnetLink) {
        return null
      }

      // Sonarr/Radarr's TorznabRssParser.GetInfoHash reads this attribute
      // exclusively (no fallback to deriving it from the magnet link for
      // Torznab specifically), so without it ReleaseInfo.InfoHash is left
      // empty and any infohash-based dedup/history matching can't work.
      //
      // It must be the SAME value the *arr derives from the magnet after a
      // grab (and that /api/v2/torrents/info reports): the 40 hex char form
      // of the ed2k hash, not the raw base32 btih from the magnet. Otherwise
      // pre-grab blocklist/dedup matching by infohash never lines up with the
      // post-grab download id.
      const infoHash = ed2kHashToClientHash(item.fileHash)

      // Backdated 24h on purpose: a pubDate that's ever in the future
      // relative to Radarr/Sonarr's own clock (even by a few seconds, from
      // ordinary clock drift) computes a negative release "age" in their
      // UI/sorting. There's no real single publish timestamp for an
      // on-the-fly aMule search result anyway, so a full day of safety
      // margin costs nothing.
      const pubDate = buildRFC822Date(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      )

      return `
          <item>
            <title>${encode(item.fileName)}</title>
            <guid>${item.fileHash}-${encode(item.fileName)}</guid>
            <link>${encode(magnetLink)}</link>
            <pubDate>${pubDate}</pubDate>
            <enclosure url="${encode(magnetLink)}" length="${item.fileSize}" type="application/x-bittorrent" />
            <torznab:attr name="size" value="${item.fileSize}" />
            <torznab:attr name="magneturl" value="${encode(magnetLink)}" />
            <torznab:attr name="infohash" value="${infoHash}" />
            ${categories.map((c) => `<torznab:attr name="category" value="${c}" />`).join('')}
            <torznab:attr name="seeders" value="${item.sourceCount}" />
            <torznab:attr name="downloadvolumefactor" value="0" />
            <torznab:attr name="uploadvolumefactor" value="0" />
            <torznab:attr name="minimumratio" value="0" />
            <torznab:attr name="minimumseedtime" value="0" />
            <torznab:attr name="tag" value="freeleech" />
          </item>`
    })
    .filter(skipFalsy)

  return `
  <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
    <channel>
      <torznab:response offset="0" total="${items.length}"/>
      ${items.join('')}
    </channel>
  </rss>
  `
}

export function group<T>(
  arr: T[],
  operator: 'AND' | 'OR',
  parenthesis: boolean,
) {
  arr = arr.filter(skipFalsy)

  const joined =
    operator === 'OR'
      ? arr.join(` ${operator} `)
      : arr
          .sort(
            // move parenthesis to the end
            (a, b) =>
              (typeof a === 'string' && a.startsWith('(') ? 1 : 0) -
              (typeof b === 'string' && b.startsWith('(') ? 1 : 0),
          )
          .reduce(
            (prev, curr) =>
              prev === ''
                ? `${curr}`
                : prev.endsWith(')') ||
                    (typeof curr === 'string' && curr.startsWith('('))
                  ? `${prev} AND ${curr}`
                  : `${prev} ${curr}`,
            '',
          )

  if (!parenthesis) {
    return joined
  }

  return arr.length > 1 ? `(${joined})` : `${arr[0] ?? ''}`
}
