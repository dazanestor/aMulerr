import { useAmule } from '#/amule'
import { skipFalsy } from '#/lib/array'
import { addDeletedHash } from '#/lib/deleted'
import { clientHashToEd2kHash } from '#/lib/links'
import { createFileRoute } from '@tanstack/react-router'
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
          .toUpperCase()
          .split('|')
          .filter(skipFalsy)
          .map((h) => clientHashToEd2kHash(h))

        const deleteFilesQsp = formData.get('deleteFiles')?.toString()
        const deleteFiles =
          !deleteFilesQsp || deleteFilesQsp.toLowerCase() === 'true'

        if (hashes?.length) {
          await useAmule(async (amule) => {
            const shared = await amule.getSharedFiles()
            const matches = shared.filter(
              (f) => f.fileHash && hashes.includes(f.fileHash.toUpperCase()),
            )

            // ?? not skipFalsy: an ecid of 0 is a valid identifier (see
            // AmuleClient.mjs's getSharedFiles/getUpdate) and must not be
            // dropped, or that file's stale "known" entry never gets
            // cleared via EC_OP_CLEAR_COMPLETED.
            const ecids = matches
              .map((f) => f.ecid)
              .filter((ecid): ecid is number => ecid !== undefined)
            await amule.clearCompleted(ecids)

            for (const hash of hashes) {
              await amule.cancelDownload(hash)
              addDeletedHash(hash)
            }

            // Only physically delete files when the caller asked for it —
            // this used to run unconditionally before the deleteFiles check
            // below, so `deleteFiles=false` (remove from queue, keep the
            // downloaded data) was silently ignored and the file was deleted
            // anyway.
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
