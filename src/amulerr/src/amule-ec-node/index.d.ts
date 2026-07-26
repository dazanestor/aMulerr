declare module '#/amule-ec-node/AmuleClient.mjs' {
  export type AmuleTagTree = {
    EC_TAG_STATS_ED2K_USERS: number
    EC_TAG_STATS_KAD_USERS: number
    EC_TAG_CONNSTATE: {
      EC_TAG_ED2K_ID: number
      EC_TAG_CLIENT_ID: number
      EC_TAG_KAD_ID: string
    }
  }

  export interface AmuleClientOptions {
    requestTimeout?: number
  }

  export interface SharedFile {
    ecid?: number
    fileName?: string
    rawFileName?: string
    fileHash?: string
    fileSize?: number
    transferred?: number
    transferredTotal?: number
    reqCount?: number
    reqCountTotal?: number
    acceptedCount?: number
    acceptedCountTotal?: number
    priority?: number
    path?: string
    completeSources?: number
    onQueue?: number
    ed2kLink?: string
    comment?: string
    rating?: number
    raw?: AmuleTagTree
  }

  export interface DownloadItem {
    ecid?: number
    fileName: string
    fileHash: string
    fileSize: number
    ed2kLink?: string
    fileSizeDownloaded?: number
    speed?: number
    rating?: number
    status?: number
    sourceCount?: number
    sourceCountNotCurrent?: number
    sourceCountXfer?: number
    sourceCountA4AF?: number
    lastSeenComplete?: number
    lastReceived?: number
    downloadActiveTime?: number
    category?: number
    progress?: string
    raw?: AmuleTagTree
  }

  export interface SearchResults {
    resultsLength: number
    results: DownloadItem[]
  }

  export interface Category {
    id: number
    title: string
    path: string
    comment: string
    color: number
    priority: number
  }

  export interface CategoryCreateResult {
    success: boolean
    categoryId: number | null
  }

  export default class AmuleClient {
    constructor(
      host: string,
      port: number,
      password: string,
      options?: AmuleClientOptions,
    )

    connect(): Promise<void>
    close(): void

    getStats(): Promise<AmuleTagTree>

    getSharedFiles(): Promise<SharedFile[]>
    clearCompleted(
      ecids: number[],
    ): Promise<{ opcode: number; cleared: number[] }>
    refreshSharedFiles(): Promise<boolean>
    getDownloadQueue(): Promise<DownloadItem[]>

    getSearchResults(): Promise<SearchResults>
    searchAndWaitResults(opts: {
      query: string
      network: 'global' | 'local' | 'kad' | number
      timeoutMs?: number
      extension?: string
    }): Promise<SearchResults | null>
    cancelDownload(fileHash: string): Promise<boolean>
    addEd2kLink(link: string, categoryId?: number): Promise<boolean>
    pauseDownload(fileHash: string): Promise<boolean>
    resumeDownload(fileHash: string): Promise<boolean>

    getIncomingDir(): Promise<string | null>
    getCategories(): Promise<Category[]>
    createCategory(
      title: string,
      path?: string,
      comment?: string,
      color?: number,
      priority?: number,
    ): Promise<CategoryCreateResult>
    updateCategory(
      categoryId: number,
      title: string,
      path?: string,
      comment?: string,
      color?: number,
      priority?: number,
    ): Promise<boolean>
    deleteCategory(categoryId: number): Promise<boolean>
    setFileCategory(fileHash: string, categoryId: number): Promise<boolean>
    setDownloadPriority(fileHash: string, priority: number): Promise<boolean>

    buildTagTree(tags: unknown[]): AmuleTagTree
    parseCategories(tags: unknown[]): Category[]
  }
}
