import { useAmule } from '#/amule'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-contents
export const Route = createFileRoute('/api/v2/torrents/files')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const hash = url.searchParams.get('hash')

        if (!hash) {
          return Response.json([], { status: 404 })
        }

        const ed2kHash = clientHashToEd2kHash(hash)

        const file = await useAmule(async (amule) => {
          const downloads = await amule.getDownloadQueue()
          const shared = await amule.getSharedFiles()

          const download = downloads.find((item) => item.fileHash?.toUpperCase() === ed2kHash)
          if (download) {
            return {
              index: 0,
              name: download.fileName,
              size: download.fileSize,
              progress: download.fileSizeDownloaded ?? 0,
              priority: 1,
              is_seed: true,
              availability: 1,
            }
          }

          const sharedFile = shared.find((item) => item.fileHash?.toUpperCase() === ed2kHash)
          if (sharedFile) {
            return {
              index: 0,
              name: sharedFile.fileName,
              size: sharedFile.fileSize,
              progress: 1,
              priority: 1,
              is_seed: true,
              availability: 1,
            }
          }

          return null
        })

        if (!file) {
          return Response.json([], { status: 404 })
        }

        return Response.json([file])
      },
    },
  },
})
