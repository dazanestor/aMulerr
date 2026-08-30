import { createFileRoute } from '@tanstack/react-router'

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-application-preferences
//
// aMule preferences aren't settable via this bridge. Cleanuparr's malware
// blocker calls this to push its `excluded_file_names` blacklist; accept and
// ignore it rather than 404 so that job doesn't error out. (Content blocking
// isn't meaningful for single-file ed2k downloads anyway.)
export const Route = createFileRoute('/api/v2/app/setPreferences')({
  server: {
    handlers: {
      POST: async () => new Response('Ok', { status: 200 }),
    },
  },
})
