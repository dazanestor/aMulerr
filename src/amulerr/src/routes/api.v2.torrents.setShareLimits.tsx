import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-torrent-share-limit
//
// Radarr/Sonarr call this when a per-release seed ratio/time is configured
// (RemoteMovie/RemoteEpisode.SeedConfiguration). aMule has no per-download
// seed ratio/time enforcement exposed via EC — our own /api/v2/app/preferences
// already reports the global limits as disabled, so there is nothing for
// this endpoint to actually enforce. Accept the request rather than 404 so
// Radarr/Sonarr don't log a spurious failure for a setting that simply
// doesn't apply to this download client.
export const Route = createFileRoute('/api/v2/torrents/setShareLimits')({
  server: {
    handlers: {
      POST: async () => {
        return new Response('Ok', { status: 200 })
      },
    },
  },
})
