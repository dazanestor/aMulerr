import { useAmule } from '#/amule'
import { ignoredCategories, isCategoryAllowed } from '#/lib/categories'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v2/torrents/createCategory')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const formData = await request.formData()
        const categoryTitle = formData.get('category')?.toString()

        if (categoryTitle) {
          if (!isCategoryAllowed(categoryTitle)) {
            console.log(
              `Ignoring creation of category "${categoryTitle}" (not in allowed list)`,
            )
            ignoredCategories.add(categoryTitle)
            return Response.json({})
          }

          await useAmule(async (amule) => {
            // Used to create-then-immediately-delete a throwaway category
            // just to read its default path. That's a real, confirmed
            // aMule daemon crash (isc30/aMulerr#17: "Assertion '__n <
            // this->size()' failed" -> Aborted, repeatedly reproduced
            // right after 'ExternalConn: adding link ...'): category
            // creation appends to a plain std::vector and deletion does a
            // vector::erase, which shifts every later index down by one.
            // Two concurrent createCategory calls (e.g. Radarr and Sonarr
            // both provisioning their category around the same time, which
            // is the normal case for this bridge) can interleave so one
            // request's dummy sits at an index the other request then
            // deletes out from under it, leaving a stale, now out-of-range
            // category id — the exact crash in the reports. Querying the
            // incoming dir directly (the same value aMule itself assigns as
            // a new category's default path) needs no create/delete at all.
            const incomingDir = await amule.getIncomingDir()

            const categories = await amule.getCategories()
            const category = categories.find((c) => c.title === categoryTitle)

            if (category) {
              if (
                !(await amule.updateCategory(
                  category.id,
                  categoryTitle,
                  `${incomingDir}/${categoryTitle}`,
                  'amulerr',
                ))
              ) {
                throw new Error(`Failed to update category ${categoryTitle}`)
              }
            } else {
              // createCategory resolves to { success, categoryId }, not a boolean —
              // negating the whole object was always false (objects are truthy),
              // so a real failure here was never surfaced as an error.
              if (
                !(
                  await amule.createCategory(
                    categoryTitle,
                    `${incomingDir}/${categoryTitle}`,
                    'amulerr',
                  )
                ).success
              ) {
                throw new Error(`Failed to create category ${categoryTitle}`)
              }
            }
          })
        }

        return Response.json({})
      },
    },
  },
})
