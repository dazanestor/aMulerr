import { useAmule } from '#/amule'
import { fromMagnetLink, toEd2kLink } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/torrents/add')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const urls = formData.get('urls')?.toString()
        const category = formData.get('category')?.toString()
        // Radarr/Sonarr's qBittorrent client sends "stopped" (webapi >= 2.11.0,
        // which is what we report) or the legacy "paused" name for older
        // versions, set from the download client's "Initial State" setting.
        const addStopped =
          formData.get('stopped')?.toString() === 'true' ||
          formData.get('paused')?.toString() === 'true'

        if (!urls) {
          throw new Error('No URL to download')
        }

        if (!category) {
          throw new Error('No download category')
        }

        const { hash, name, size } = fromMagnetLink(urls)
        const ed2kLink = toEd2kLink(hash, name, size)

        await useAmule(async (amule) => {
          const categories = await amule.getCategories()
          const categoryId = categories.find((c) => c.title === category)?.id
          if (!categoryId) {
            throw new Error(`Category ${category} not found`)
          }

          if (!(await amule.addEd2kLink(ed2kLink, categoryId))) {
            throw new Error(`Failed to add torrent ${ed2kLink}`)
          }

          if (addStopped) {
            await amule.pauseDownload(hash)
          }
        })

        return Response.json({})
      },
    },
  },
})
