import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#maximal-priority
//
// Radarr/Sonarr's qBittorrent client calls this when "Recent/Older Movie
// Priority" (or the equivalent series setting) is "First", right after
// adding a torrent. aMule has no distinct "queue position" concept, but it
// does have a real per-download priority (PR_LOW/NORMAL/HIGH/VERYHIGH/AUTO)
// that affects scheduling — PR_VERYHIGH is the closest honest equivalent to
// "move to top of queue".
const PR_VERYHIGH = 3

export const Route = createFileRoute('/api/v2/torrents/topPrio')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const hashes = formData
          .get('hashes')
          ?.toString()
          .toUpperCase()
          .split('|')
          .filter(skipFalsy)
          .map((h) => clientHashToEd2kHash(h))

        if (hashes?.length) {
          await useAmule(async (amule) => {
            for (const hash of hashes) {
              await amule.setDownloadPriority(hash, PR_VERYHIGH)
            }
          })
        }

        return new Response('Ok', { status: 200 })
      },
    },
  },
})
