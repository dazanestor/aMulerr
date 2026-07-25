import { useAmule } from '#/amule'
import type { DownloadItem } from '#/amule-ec-node/AmuleClient.mjs'
import { isHashDeleted } from '#/lib/deleted'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/torrents/info')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const categoryTitle = url.searchParams.get('category')

        const { categories, shared, downloads } = await useAmule(
          async (amule) => {
            const rawCategories = await amule.getCategories()
            // Fetch downloads and shared files concurrently: a completed download
            // transitioning between the two lists (aMule moves it out of the
            // download queue and into shared files) could otherwise fall into
            // the gap between two sequential round-trips.
            const [rawDownloads, rawShared] = await Promise.all([
              amule.getDownloadQueue(),
              amule.getSharedFiles(),
            ])

            return {
              categories: rawCategories,
              downloads: rawDownloads.map((d) => ({
                ...d,
                category_obj: rawCategories.find((c) => c.id === d.category),
              })),
              shared: rawShared
                .filter(
                  (s) =>
                    s.fileHash &&
                    !isHashDeleted(s.fileHash) &&
                    !rawDownloads.some((d) => d.fileHash === s.fileHash),
                )
                .map((d) => ({
                  ...d,
                  category_obj: rawCategories.find((c) => c.path === d.path),
                })),
            }
          },
        )

        const filterCategory = categories.find((c) => c.title === categoryTitle)
        if (categoryTitle && !filterCategory) {
          return Response.json([])
        }

        const filteredDownloads = categoryTitle
          ? downloads.filter((d) => d.category_obj === filterCategory)
          : downloads

        const filteredShared = categoryTitle
          ? shared.filter((s) => s.category_obj === filterCategory)
          : shared

        // qBittorrent structure
        return Response.json([
          ...filteredDownloads.map((f) => ({
            hash: f.fileHash,
            name: f.fileName,
            size: f.fileSize,
            tracker: 'http://amulerr',
            downloaded: f.fileSizeDownloaded,
            progress: Math.min(99.99, parseFloat(f.progress ?? '0')) / 100,
            dlspeed: f.speed,
            // Radarr/Sonarr's QBittorrentTorrent.Eta is a BigInteger (chosen
            // specifically to hold real qBittorrent's occasional huge
            // sentinel values, not to hold fractions) — a JSON number with a
            // decimal point deserializes as a Float token, which
            // Newtonsoft's BigIntegerConverter doesn't accept, so this must
            // stay a whole number.
            eta:
              f.speed && f.speed > 0
                ? Math.floor(
                    (f.fileSize - (f.fileSizeDownloaded ?? 0)) / f.speed,
                  )
                : 8640000,
            state: statusToQbittorrentState(f),
            content_path: `${f.category_obj?.path}/${f.fileName}`,
            save_path: f.category_obj?.path,
            category: f.category_obj?.title,
            amount_left: f.fileSize - (f.fileSizeDownloaded ?? 0),
            num_complete: f.sourceCount,
            num_incomplete: f.sourceCountNotCurrent,
            num_leechs: f.sourceCountXfer,
            num_seeds: f.sourceCountA4AF,
            seen_complete: f.lastSeenComplete,
            last_activity: f.lastReceived,
            time_active: f.downloadActiveTime,
            added_on:
              Math.floor(Date.now() / 1000) - (f.downloadActiveTime ?? 0),
            // aMule has no seed ratio/time enforcement, so there's no real
            // per-torrent limit to report — but explicitly reporting a
            // *reached* limit (0 required, already satisfied) matters:
            // Radarr/Sonarr's HasReachedSeedLimit() short-circuits to false
            // whenever the per-torrent limit is left at -2/"use global" AND
            // the global limit is disabled (which ours is, in preferences).
            // Without this, CanMoveFiles/CanBeRemoved are always false, so
            // completed downloads get imported via Copy instead of Move and
            // are never auto-removed from the queue — silently doubling
            // disk usage forever.
            seeding_time_limit: 0,
            seeding_time: f.downloadActiveTime ?? 0,
          })),
          ...filteredShared.map((f) => ({
            hash: f.fileHash,
            name: f.fileName,
            size: f.fileSize,
            tracker: 'http://amulerr',
            downloaded: f.fileSize,
            progress: 1,
            dlspeed: 0,
            state: 'pausedUP' as const,
            content_path: `${f.path}/${f.fileName}`,
            save_path: f.path,
            category: f.category_obj?.title,
            seeding_time_limit: 0,
            seeding_time: 0,
          })),
        ])
      },
    },
  },
})

function statusToQbittorrentState(f: DownloadItem) {
  switch (f.status) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 10:
      return f.sourceCountXfer && f.sourceCountXfer > 0
        ? ('downloading' as const)
        : f.progress && parseFloat(f.progress) < 100
          ? ('stalledDL' as const)
          : ('pausedUP' as const)
    case 4:
    case 5:
    case 6:
      return 'error' as const
    case 7:
      return 'pausedDL' as const
    case 8:
      return 'moving' as const
    case 9:
      return 'pausedUP' as const
    default:
      return 'stalledDL' as const
  }
}
