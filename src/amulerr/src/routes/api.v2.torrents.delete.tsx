import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs/promises'
import path from 'node:path'

export const Route = createFileRoute('/api/v2/torrents/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const hashes = formData
          .get('hashes')
          ?.toString()
          ?.toUpperCase()
          ?.split('|')
          .filter(skipFalsy)
          .map(clientHashToEd2kHash)

        const deleteFilesQsp = formData.get('deleteFiles')?.toString()
        const deleteFiles = !deleteFilesQsp || deleteFilesQsp.toLowerCase() === 'true'

        if (hashes?.length) {
          await useAmule(async (amule) => {
            const shared = await amule.getSharedFiles()
            const matches = shared.filter(
              (f) => f.fileHash && hashes.includes(f.fileHash.toUpperCase()),
            )

            const ecids = matches.map((f) => f.ecid).filter(skipFalsy)
            await amule.clearCompleted(ecids)

            for (const hash of hashes) {
              await amule.cancelDownload(hash)
            }

            if (deleteFiles) {
              const files = matches
                .filter((f) => f.path && f.fileName)
                .map((f) => path.join(f.path!, f.fileName!))

              await Promise.allSettled(
                files.map((f) =>
                  fs.rm(f, { force: true }).catch((err) => {
                    console.error(`Failed to delete file ${f}:`, err)
                    return Promise.reject(err)
                  }),
                ),
              )

              await amule.refreshSharedFiles()
            }
          })
        }

        return Response.json({})
      },
    },
  },
})
