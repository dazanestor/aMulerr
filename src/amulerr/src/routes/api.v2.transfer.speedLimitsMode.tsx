import { qbittorrentPlainTextResponse } from '#/lib/qbittorrent'
import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-alternative-speed-limits-state
//
// "0" = alternative (throttled) speed limits are off. aMule exposes no such
// toggle via EC. Cleanuparr reads this while evaluating slow-download rules,
// so answer instead of 404ing.
export const Route = createFileRoute('/api/v2/transfer/speedLimitsMode')({
  server: {
    handlers: {
      GET: async () => qbittorrentPlainTextResponse('0'),
    },
  },
})
