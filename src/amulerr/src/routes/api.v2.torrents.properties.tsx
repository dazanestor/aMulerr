import { useAmule } from '#/amule'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-generic-properties
//
// Radarr/Sonarr's qBittorrent client (QBittorrentProxyV2.IsTorrentLoaded /
// GetTorrentProperties) calls this right after adding a torrent whenever the
// download client has seed ratio/time limits, "move to top of queue", or
// "force start" configured, and reads save_path/seeding_time from it. Without
// this route those calls 404 and the affected settings are silently skipped
// (Radarr just logs a warning and moves on), but the endpoint itself is part
// of the real qBittorrent surface so it's worth implementing properly.
export const Route = createFileRoute('/api/v2/torrents/properties')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const hash = url.searchParams.get('hash')

        if (!hash) {
          return Response.json({}, { status: 404 })
        }

        const properties = await useAmule(async (amule) => {
          const categories = await amule.getCategories()
          const downloads = await amule.getDownloadQueue()
          const shared = await amule.getSharedFiles()

          const download = downloads.find(
            (item) => item.fileHash.toLowerCase() === hash.toLowerCase(),
          )
          if (download) {
            const category = categories.find((c) => c.id === download.category)
            return {
              save_path: category?.path ?? '',
              // aMule has no seeding-time concept once a download completes and
              // becomes a shared file; our own preferences already report seed
              // ratio/time limits as disabled, so 0 is never compared against
              // a real limit.
              seeding_time: 0,
            }
          }

          const sharedFile = shared.find(
            (item) => item.fileHash?.toLowerCase() === hash.toLowerCase(),
          )
          if (sharedFile) {
            const category = categories.find((c) => c.path === sharedFile.path)
            return {
              save_path: category?.path ?? sharedFile.path ?? '',
              seeding_time: 0,
            }
          }

          return null
        })

        if (!properties) {
          return Response.json({}, { status: 404 })
        }

        return Response.json(properties)
      },
    },
  },
})
