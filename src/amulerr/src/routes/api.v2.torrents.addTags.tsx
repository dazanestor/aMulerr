import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#add-torrent-tags
//
// Sonarr calls this (QBittorrentProxyV2.AddTags) when "Add Series Tags" is
// enabled on the download client, to label the torrent in qBittorrent with
// the series' Sonarr tags. qBittorrent's "tags" are a separate multi-value
// concept from "category" — aMule has nothing equivalent (only a single
// category and a free-text comment per download), so there is nothing real
// to do here. Accept the request instead of 404ing so Sonarr doesn't log a
// spurious failure for a setting that doesn't apply to this download client.
export const Route = createFileRoute('/api/v2/torrents/addTags')({
  server: {
    handlers: {
      POST: async () => {
        return new Response('Ok', { status: 200 })
      },
    },
  },
})
