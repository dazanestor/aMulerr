import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#resume-torrents
export const Route = createFileRoute('/api/v2/torrents/resume')({
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
              await amule.resumeDownload(hash)
            }
          })
        }

        return new Response('Ok', { status: 200 })
      },
    },
  },
})
