import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-file-priority
//
// An ed2k download is a single file with no per-file priority, so there's
// nothing to set. Cleanuparr's malware blocker calls this to mark unwanted
// files as "do not download"; accept and ignore rather than 404.
export const Route = createFileRoute('/api/v2/torrents/filePrio')({
  server: {
    handlers: {
      POST: async () => new Response('Ok', { status: 200 }),
    },
  },
})
