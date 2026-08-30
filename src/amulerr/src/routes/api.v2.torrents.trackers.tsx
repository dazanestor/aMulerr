import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-trackers
//
// aMule downloads have no BitTorrent trackers — sources come from ed2k
// servers and Kademlia. Cleanuparr's qBittorrent client calls this for every
// queue item it evaluates and treats a non-2xx response as a hard failure,
// so return an empty tracker list rather than 404. (Real qBittorrent's only
// entries for a trackerless torrent are the `** [DHT] **` / `** [PeX] **`
// pseudo-trackers, which Cleanuparr filters out anyway.)
export const Route = createFileRoute('/api/v2/torrents/trackers')({
  server: {
    handlers: {
      GET: async () => Response.json([]),
    },
  },
})
