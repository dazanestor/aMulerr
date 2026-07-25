import { useAmule } from '#/amule'
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

        const file = await useAmule(async (amule) => {
          const downloads = await amule.getDownloadQueue()
          const shared = await amule.getSharedFiles()

          const download = downloads.find(
            (item) => item.fileHash.toLowerCase() === hash.toLowerCase(),
          )
          if (download) {
            // qBittorrent's API reports progress as a 0-1 fraction, not raw bytes.
            const progress =
              download.fileSize > 0
                ? (download.fileSizeDownloaded ?? 0) / download.fileSize
                : 0
            return {
              index: 0,
              name: download.fileName,
              size: download.fileSize,
              progress,
              priority: 1,
              is_seed: true,
              availability: 1,
            }
          }

          const sharedFile = shared.find(
            (item) => item.fileHash?.toLowerCase() === hash.toLowerCase(),
          )
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
