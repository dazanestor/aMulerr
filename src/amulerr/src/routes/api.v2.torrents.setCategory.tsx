
import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/torrents/setCategory')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const hashes = formData
          .get("hashes")
          ?.toString()
          ?.toUpperCase()
          ?.split("|")
          .filter(skipFalsy)
          .map(clientHashToEd2kHash)
        const categoryTitle = formData.get("category")?.toString()

        if (categoryTitle && hashes?.length) {
          await useAmule(async (amule) => {
            const categories = await amule.getCategories()
            const categoryId = categories.find(c => c.title === categoryTitle)?.id
            if (!categoryId) {
              throw new Error(`Category ${categoryTitle} not found`)
            }

            for (const hash of hashes) {
              if (!await amule.setFileCategory(hash, categoryId)) {
                throw new Error(`Failed to set category for torrent ${hash}`)
              }
            }
          })
        }

        return Response.json({})
      }
    }
  },
})
