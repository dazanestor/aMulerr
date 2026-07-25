import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { addDeletedHash } from '#/lib/deleted'
import { createFileRoute } from '@tanstack/react-router'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const Route = createFileRoute('/api/v2/torrents/delete')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const formData = await request.formData()
        const hashes = formData
          .get('hashes')
          ?.toString()
          ?.toUpperCase()
          ?.split('|')
          .filter(skipFalsy)

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
              addDeletedHash(hash)
            }

            // If the files exist on disk, delete them physically
            for (const f of shared.filter(f => f.fileHash && hashes.includes(f.fileHash.toUpperCase()))) {
              const fullPath = f.path && f.fileName ? `${f.path}/${f.fileName}` : ''
              if (fullPath && fsSync.existsSync(fullPath)) {
                try {
                  console.log(`Physically deleting file: ${fullPath}`)
                  fsSync.rmSync(fullPath, { force: true })
                } catch (err: any) {
                  console.error(`Failed to delete physical file ${fullPath}:`, err.message)
                }
              }
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
