import { useAmule } from '#/amule'
import { clientHashToEd2kHash } from '#/lib/links'
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
//
// Cleanuparr reads `is_private` out of QBittorrent.Client's [JsonExtensionData]
// bag (`AdditionalData`) without null-checking it, so a response containing only
// the two fields above deserializes with AdditionalData == null and Cleanuparr
// NREs. Return a full qBittorrent-shaped object (including is_private/private
// and enough fields that the extension bag is always populated).
export const Route = createFileRoute('/api/v2/torrents/properties')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const hash = url.searchParams.get('hash')

        if (!hash) {
          return Response.json({}, { status: 404 })
        }

        const ed2kHash = clientHashToEd2kHash(hash)

        // aMule has no BitTorrent seeding/ratio/tracker model, so most of these
        // are honest zeros — they exist to keep the response shaped like real
        // qBittorrent's. `is_private` (and its newer name `private`) matter:
        // Cleanuparr reads them and does not tolerate their absence.
        const baseProperties = {
          save_path: '',
          name: '',
          hash: hash.toUpperCase(),
          is_private: false,
          private: false,
          creation_date: 0,
          piece_size: 0,
          comment: 'amulerr',
          total_wasted: 0,
          total_uploaded: 0,
          total_uploaded_session: 0,
          total_downloaded: 0,
          total_downloaded_session: 0,
          up_limit: -1,
          dl_limit: -1,
          time_elapsed: 0,
          seeding_time: 0,
          nb_connections: 0,
          nb_connections_limit: 100,
          share_ratio: 0,
          addition_date: Math.floor(Date.now() / 1000),
          completion_date: -1,
          created_by: '',
          dl_speed_avg: 0,
          dl_speed: 0,
          eta: 8640000,
          last_seen: -1,
          peers: 0,
          peers_total: 0,
          pieces_have: 0,
          pieces_num: 0,
          reannounce: 0,
          seeds: 0,
          seeds_total: 0,
          total_size: 0,
          up_speed_avg: 0,
          up_speed: 0,
        }

        const properties = await useAmule(async (amule) => {
          const categories = await amule.getCategories()
          const downloads = await amule.getDownloadQueue()
          const shared = await amule.getSharedFiles()

          const download = downloads.find(
            (item) => item.fileHash.toUpperCase() === ed2kHash,
          )
          if (download) {
            const category = categories.find((c) => c.id === download.category)
            return {
              ...baseProperties,
              save_path: category?.path ?? '',
              name: download.fileName,
              total_downloaded: download.fileSizeDownloaded ?? 0,
              total_size: download.fileSize,
              dl_speed: download.speed ?? 0,
              time_elapsed: download.downloadActiveTime ?? 0,
              addition_date:
                Math.floor(Date.now() / 1000) -
                (download.downloadActiveTime ?? 0),
            }
          }

          const sharedFile = shared.find(
            (item) => item.fileHash?.toUpperCase() === ed2kHash,
          )
          if (sharedFile) {
            const category = categories.find((c) => c.path === sharedFile.path)
            return {
              ...baseProperties,
              save_path: category?.path ?? sharedFile.path ?? '',
              name: sharedFile.fileName,
              total_downloaded: sharedFile.fileSize,
              total_size: sharedFile.fileSize,
              completion_date: Math.floor(Date.now() / 1000),
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
