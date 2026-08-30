import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-force-start
//
// Radarr/Sonarr call this when the download client's "Initial State" is
// "Force Start" — meaning "start regardless of queueing/slot limits". aMule
// has no separate queueing system to bypass (every added download starts
// immediately), so the only meaningful action here is making sure the
// download is actually running rather than paused; there's no distinct
// "force" state to revert to when value=false, so that case is a no-op.
export const Route = createFileRoute('/api/v2/torrents/setForceStart')({
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
        const value = formData.get('value')?.toString() === 'true'

        if (value && hashes?.length) {
          await useAmule(async (amule) => {
            for (const hash of hashes) {
              await amule.resumeDownload(hash)
            }
          })
        }

        return new Response('Ok', { status: 200 })
      },
    },
  },
})
