
import { useAmule } from '#/amule'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/torrents/categories')({
  server: {
    handlers: {
      GET: async () => {
        const categories = await useAmule(async (amule) => await amule.getCategories());
        const properCategories = categories.filter(c => c.comment === "amulerr")
        const result = Object.fromEntries(properCategories.map(c => [c.title, { name: c.title, savePath: c.path, comment: c.comment }]))

        return Response.json(result)
      }
    }
  },
})
