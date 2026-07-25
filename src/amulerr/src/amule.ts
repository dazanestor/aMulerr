import AmuleClient, { type DownloadItem } from '#/amule-ec-node/AmuleClient.mjs'
import { Mutex } from "async-mutex"
import { sanitizeFilename, sanitizeQuery, setReleaseGroup } from './lib/naming';
import { groupBy, skipFalsy, toEntries } from './lib/array';

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            PUID: string;
            PGID: string;
            AMULE_HOST: string;
            AMULE_PORT: string;
            AMULE_PWD: string;
        }
    }
}


export async function useAmule<T>(fn: (client: AmuleClient) => T) {
    const amuleClient = new AmuleClient(process.env.AMULE_HOST, parseInt(process.env.AMULE_PORT), process.env.AMULE_PWD);
    try {
        await amuleClient.connect();
        return await fn(amuleClient)
    } finally {
        amuleClient.close();
    }
}

const CACHE_TTL_MS = 1000 * 60 * 5 // 5 minutes

const searchMutex = new Mutex()
const searchCache = new Map<string, { timestamp: Date, data: DownloadItem[] }>()

// Entries only get evicted when the *same* query is searched again, so distinct
// queries (every distinct movie/episode title Radarr/Sonarr ever searches for)
// would otherwise accumulate here for the process lifetime. Sweep everything
// past its TTL whenever we touch the cache, so it stays bounded to what's
// actually been searched in the last CACHE_TTL_MS.
function evictExpiredCacheEntries() {
    const now = Date.now()
    for (const [key, entry] of searchCache) {
        if (now - entry.timestamp.getTime() >= CACHE_TTL_MS) {
            searchCache.delete(key)
        }
    }
}

export async function searchAll(q: string) {
    const sanitizedQuery = sanitizeQuery(q)

    evictExpiredCacheEntries()

    const cache = searchCache.get(sanitizedQuery)
    if (cache && (Date.now() - cache.timestamp.getTime()) < CACHE_TTL_MS) {
        console.log(`Cache hit for query "${sanitizedQuery}"`)
        return cache.data
    }

    searchCache.delete(sanitizedQuery)

    return await searchMutex.runExclusive(async () => {
        const cache = searchCache.get(sanitizedQuery)
        if (cache && (Date.now() - cache.timestamp.getTime()) < CACHE_TTL_MS) {
            console.log(`Cache hit for query "${sanitizedQuery}"`)
            return cache.data
        }

        return await useAmule(async (amule) => {
            const stats = await amule.getStats()
            const networks = [
                // 'local' as const,
                stats.EC_TAG_CONNSTATE.EC_TAG_ED2K_ID ? 'global' as const : null,
                stats.EC_TAG_CONNSTATE.EC_TAG_KAD_ID ? 'kad' as const : null,
            ].filter(skipFalsy)

            console.log(`Searching for "${sanitizedQuery}" in [${networks.join(", ")}] ...`)
            const results: DownloadItem[] = []

            const totalTimeoutMs = 50_000
            const startedAt = Date.now()
            for (let i = 0; i < networks.length; i++) {
                const network = networks[i]
                const elapsedMs = Date.now() - startedAt
                const remainingBudgetMs = totalTimeoutMs - elapsedMs
                const remainingNetworks = networks.length - i
                const timeoutMs = Math.floor(remainingBudgetMs / remainingNetworks)

                console.log(`Searching "${network}" results for query "${sanitizedQuery}" with timeout ${timeoutMs}ms ...`)
                const networkResults = (await amule.searchAndWaitResults({
                    query: sanitizedQuery,
                    network,
                    timeoutMs
                }))?.results ?? []

                console.log(`${network} search returned ${networkResults.length} results for query "${sanitizedQuery}"`)
                results.push(...networkResults)
            }

            console.log(`Total search results for query "${sanitizedQuery}": ${results.length}`)
            const data = results.map(r => ({
                ...r,
                fileName: sanitizeFilename(setReleaseGroup(r.fileName))
            }))

            // if the same hash+size, sum the sources
            const hashGroups = toEntries(groupBy(data, (f) => f.fileHash + f.fileSize))
            hashGroups.forEach(([, results]) => {
                let sourceCount = 0
                results.forEach((r) => {
                    sourceCount += r.sourceCount ?? 0
                })
                results.forEach((r) => {
                    r.sourceCount = sourceCount
                })
            })

            searchCache.set(sanitizedQuery, { timestamp: new Date(), data })
            return data
        })
    })
}
