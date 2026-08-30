import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/sync/maindata')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ rid: 0, full_update: false })
      },
    },
  },
})
