<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { RemoteMediaErrorCode, RemoteMediaItem, RemoteMediaPage } from "../../../types/remote/control"
    import Icon from "../../common/components/Icon.svelte"
    import { onResponse, send } from "../util/socket"
    import { isConnected } from "../util/stores"

    export let active = true

    type PageRequest = { path: string; page: number; generation: number }
    type ThumbnailRequest = { path: string; generation: number }
    const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024

    let currentPath = ""
    let parentPath = ""
    let currentPage = 0
    let pages = new Map<number, RemoteMediaPage>()
    let loading = false
    let errorMessage = ""
    let actionMessage = ""
    let started = false
    let generation = 0
    let requestCounter = 0
    let lastBrowseRequestId = ""
    let pendingBrowse = new Map<string, PageRequest>()
    let thumbnails: Record<string, string> = {}
    let thumbnailQueue: string[] = []
    let requestedThumbnails = new Set<string>()
    let pendingThumbnails = new Map<string, ThumbnailRequest>()
    let thumbnailBytes = 0
    let pendingPlay = new Map<string, { path: string; generation: number }>()
    let playingPath = ""
    let resultError = ""

    $: pageData = pages.get(currentPage)

    function makeRequestId() {
        requestCounter += 1
        return `${Date.now().toString(36)}-${requestCounter.toString(36)}`
    }

    function cancelBrowse() {
        if (lastBrowseRequestId) send("MEDIA_CANCEL", { requestId: lastBrowseRequestId })
        lastBrowseRequestId = ""
        pendingBrowse.clear()
        loading = false
    }

    function cancelThumbnails() {
        thumbnailQueue = []
        requestedThumbnails = new Set()
        thumbnails = {}
        thumbnailBytes = 0
    }

    function openFolder(path: string) {
        cancelBrowse()
        cancelThumbnails()
        generation += 1
        currentPath = path
        parentPath = ""
        currentPage = 0
        pages = new Map()
        errorMessage = ""
        actionMessage = ""
        resultError = ""
        pendingPlay.clear()
        playingPath = ""
        requestPage(0)
    }

    function requestPage(page: number) {
        if (!$isConnected || loading) return

        const cursor = page > 0 ? pages.get(page - 1)?.nextCursor : undefined
        if (page > 0 && !cursor) {
            errorMessage = "This page is no longer available. Restart this folder to continue."
            return
        }

        const requestId = makeRequestId()
        pendingBrowse.set(requestId, { path: currentPath, page, generation })
        lastBrowseRequestId = requestId
        loading = true
        errorMessage = ""
        send("MEDIA_LIST", { requestId, path: currentPath, page, ...(cursor ? { cursor } : {}) })
    }

    function goToPage(page: number) {
        if (pages.has(page)) {
            generation += 1
            cancelThumbnails()
            currentPage = page
            errorMessage = ""
            pendingPlay.clear()
            playingPath = ""
            return
        }
        requestPage(page)
    }

    function restartCurrentFolder() {
        actionMessage = "The folder listing expired. Restarting from the first page."
        openFolder(currentPath)
    }

    function handlePage(data: RemoteMediaPage) {
        const request = pendingBrowse.get(data.requestId)
        if (!request) return
        pendingBrowse.delete(data.requestId)
        if (request.generation !== generation || request.path !== currentPath || request.page !== data.page) return

        loading = false
        lastBrowseRequestId = data.requestId
        parentPath = data.parentPath || ""
        const nextPages = new Map(pages)
        nextPages.set(data.page, data)
        while (nextPages.size > 6) nextPages.delete(Math.min(...nextPages.keys()))
        pages = nextPages
        currentPage = data.page
        errorMessage = ""
        actionMessage = ""
    }

    function describeError(code: RemoteMediaErrorCode | string) {
        if (code === "busy") return "Media browsing is busy. Try again in a moment."
        if (code === "thumbnail_busy") return "Previews are busy. Try again in a moment."
        if (code === "cursor_expired" || code === "restart_required") return "This folder listing expired. Restarting from the first page."
        if (code === "too_large") return "This preview is too large to load. You can still play the media."
        if (code === "invalid_path" || code === "not_media" || code === "unavailable") return "This media location is unavailable. Go up one level or choose another folder."
        return "The media request failed. Try again."
    }

    function handleError(data: { requestId: string; code: string }) {
        const browseRequest = pendingBrowse.get(data.requestId)
        if (browseRequest) {
            pendingBrowse.delete(data.requestId)
            if (browseRequest.generation !== generation || browseRequest.path !== currentPath) return
            loading = false
            if (data.code === "cursor_expired" || data.code === "restart_required") {
                restartCurrentFolder()
                return
            }
            errorMessage = describeError(data.code)
            return
        }

        const thumbnailRequest = pendingThumbnails.get(data.requestId)
        if (thumbnailRequest) {
            pendingThumbnails.delete(data.requestId)
            if (thumbnailRequest.generation !== generation) {
                flushThumbnailQueue()
                return
            }
            thumbnails = { ...thumbnails, [thumbnailRequest.path]: "" }
            flushThumbnailQueue()
            if (data.code === "thumbnail_busy") actionMessage = describeError(data.code)
            return
        }

        if (pendingPlay.has(data.requestId)) {
            const request = pendingPlay.get(data.requestId)!
            pendingPlay.delete(data.requestId)
            if (request.generation !== generation) return
            playingPath = ""
            resultError = describeError(data.code)
        }
    }

    function queueThumbnail(path: string) {
        if (!active || !$isConnected || requestedThumbnails.has(path) || thumbnails[path] !== undefined) return
        requestedThumbnails.add(path)
        thumbnailQueue = [...thumbnailQueue, path]
        flushThumbnailQueue()
    }

    function flushThumbnailQueue() {
        while (pendingThumbnails.size < 2 && thumbnailQueue.length) {
            const path = thumbnailQueue.shift()!
            if (thumbnails[path] !== undefined) continue
            const requestId = makeRequestId()
            pendingThumbnails.set(requestId, { path, generation })
            send("MEDIA_THUMBNAIL", { requestId, path })
        }
    }

    function observeMedia(node: HTMLElement, item: RemoteMediaItem) {
        if (item.kind !== "image" && item.kind !== "video") return
        if (typeof IntersectionObserver === "undefined") {
            queueThumbnail(item.path)
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    queueThumbnail(item.path)
                    observer.disconnect()
                }
            },
            { root: node.closest(".media-results"), rootMargin: "96px" }
        )
        observer.observe(node)
        return { destroy: () => observer.disconnect() }
    }

    function play(item: RemoteMediaItem) {
        if (playingPath) return
        const requestId = makeRequestId()
        pendingPlay.set(requestId, { path: item.path, generation })
        playingPath = item.path
        resultError = ""
        actionMessage = ""
        send("MEDIA_PLAY", { requestId, path: item.path })
    }

    function handlePlay(data: { requestId: string; ok: boolean }) {
        const request = pendingPlay.get(data.requestId)
        if (!request) return
        pendingPlay.delete(data.requestId)
        if (request.generation !== generation) return
        playingPath = ""
        if (!data.ok) resultError = "This media could not be started."
        else actionMessage = "Sent to the output."
    }

    function formatSize(size: number) {
        if (!Number.isFinite(size) || size < 0) return ""
        if (size < 1_000) return `${size} B`
        if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} kB`
        return `${(size / 1_000_000).toFixed(1)} MB`
    }

    function displayName(path: string) {
        return path.split(/[\\/]/).filter(Boolean).pop() || "Media roots"
    }

    const unsubscribers: (() => void)[] = []
    onMount(() => {
        unsubscribers.push(onResponse("MEDIA_PAGE", handlePage))
        unsubscribers.push(
            onResponse("MEDIA_THUMBNAIL_RESULT", (data) => {
                const request = pendingThumbnails.get(data.requestId)
                if (!request) return
                pendingThumbnails.delete(data.requestId)
                if (request.generation !== generation || request.path !== data.path) {
                    flushThumbnailQueue()
                    return
                }
                const size = data.thumbnail?.length || 0
                if (size && thumbnailBytes + size <= MAX_THUMBNAIL_BYTES) {
                    thumbnails = { ...thumbnails, [data.path]: data.thumbnail }
                    thumbnailBytes += size
                } else {
                    thumbnails = { ...thumbnails, [data.path]: "" }
                    if (size) actionMessage = "Preview memory limit reached. Media can still be played."
                }
                flushThumbnailQueue()
            })
        )
        unsubscribers.push(onResponse("MEDIA_ERROR", handleError))
        unsubscribers.push(onResponse("MEDIA_PLAY_RESULT", handlePlay))
    })

    $: if (active && $isConnected && !started) {
        started = true
        openFolder(currentPath)
    }

    $: if ((!active || !$isConnected) && started) {
        started = false
        generation += 1
        cancelBrowse()
        cancelThumbnails()
        if (!$isConnected) pendingThumbnails.clear()
        pendingPlay.clear()
        playingPath = ""
    }

    onDestroy(() => {
        cancelBrowse()
        cancelThumbnails()
        unsubscribers.forEach((unsubscribe) => unsubscribe())
    })
</script>

<section class="media-library" aria-label="Media library">
    <header class="library-header">
        <div class="location">
            {#if currentPath}
                <button class="back-button" type="button" on:click={() => openFolder(parentPath)} disabled={loading} aria-label="Go to parent folder" title="Go to parent folder">
                    <Icon id="back" size={1.25} />
                </button>
            {/if}
            <h2>{displayName(currentPath)}</h2>
            {#if currentPath}
                <button class="roots-button" type="button" on:click={() => openFolder("")} disabled={loading}>Media roots</button>
            {/if}
        </div>
    </header>

    {#if actionMessage || resultError}
        <p class="message" role="status">{resultError || actionMessage}</p>
    {/if}
    {#if errorMessage}
        <div class="error-state" role="alert">
            <p>{errorMessage}</p>
            <button type="button" on:click={() => requestPage(currentPage)} disabled={loading}>Try again</button>
        </div>
    {/if}

    <div class="media-results" aria-live="polite">
        {#if loading && !pageData}
            <p class="empty-state">Loading media…</p>
        {:else if pageData?.items.length}
            <div class="media-list">
                {#each pageData.items as item (item.path)}
                    <button class="media-entry" class:folder={item.kind === "folder"} type="button" use:observeMedia={item} on:click={() => (item.kind === "folder" ? openFolder(item.path) : play(item))} disabled={loading || (!!playingPath && playingPath !== item.path)}>
                        <span class="media-thumb">
                            {#if thumbnails[item.path]}
                                <img src={thumbnails[item.path]} alt="" loading="lazy" />
                            {:else}
                                <Icon id={item.kind === "folder" ? "folder" : item.kind === "audio" ? "music" : item.kind} size={1.6} />
                            {/if}
                        </span>
                        <span class="entry-copy">
                            <span class="entry-name">{item.name}</span>
                            <span class="entry-detail"
                                >{item.kind === "folder" ? "Folder" : item.kind}
                                {#if item.size > 0}<span aria-hidden="true"> · </span>{formatSize(item.size)}{/if}</span
                            >
                        </span>
                        <span class="entry-action" aria-hidden="true">
                            {#if item.kind === "folder"}
                                <Icon id="next" size={1.2} />
                            {:else if playingPath === item.path}
                                <span class="spinner"></span>
                            {:else}
                                <Icon id="play" size={1.2} />
                            {/if}
                        </span>
                    </button>
                {/each}
            </div>
        {:else if pageData}
            <p class="empty-state">
                {#if pageData.hasMore}
                    No supported media files on this page. Continue to scan the folder.
                {:else if currentPath}
                    This folder is empty.
                {:else}
                    No media folders are configured.
                {/if}
            </p>
        {:else if !$isConnected}
            <p class="empty-state">Connect to the presentation computer to browse media.</p>
        {:else if !loading && !errorMessage}
            <p class="empty-state">No media folders are configured.</p>
        {/if}
    </div>

    {#if pageData}
        <footer class="page-controls">
            <button type="button" on:click={() => goToPage(currentPage - 1)} disabled={loading || currentPage === 0}>
                <Icon id="previous" size={1.1} /> Previous
            </button>
            <span>Page {currentPage + 1}</span>
            <button type="button" on:click={() => goToPage(currentPage + 1)} disabled={loading || !pageData.hasMore}>
                Next <Icon id="next" size={1.1} />
            </button>
        </footer>
    {/if}
</section>

<style>
    .media-library {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        background: var(--primary-darkest);
        color: var(--text);
    }

    .library-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: var(--primary-darker);
    }

    .location {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
    }

    h2 {
        overflow: hidden;
        margin: 0;
        font-size: 1.05rem;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    button {
        font: inherit;
    }

    button {
        color: var(--text);
    }

    .back-button,
    .roots-button,
    .page-controls button,
    .error-state button {
        border: 1px solid var(--primary-lighter);
        border-radius: 7px;
        background: var(--primary);
        cursor: pointer;
    }

    .back-button,
    .roots-button {
        min-height: 36px;
        padding: 0 9px;
    }

    .back-button {
        display: grid;
        place-items: center;
        width: 36px;
        padding: 0;
    }

    :global(.media-library button:focus-visible) {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    button:disabled {
        cursor: default;
        opacity: 0.52;
    }

    .media-results {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: auto;
    }

    .media-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
        align-content: start;
        gap: 8px;
        width: 100%;
        padding: 12px;
    }

    .media-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        min-height: 68px;
        padding: 8px 10px;
        border: 1px solid var(--primary-lighter);
        border-radius: 8px;
        color: var(--text);
        text-align: left;
        background: var(--primary-darkest);
        cursor: pointer;
    }

    .media-entry:hover:not(:disabled) {
        border-color: var(--accent);
        background: var(--hover);
    }

    .media-entry.folder {
        background: var(--primary-darker);
    }

    .media-thumb {
        display: grid;
        flex: 0 0 52px;
        width: 52px;
        height: 48px;
        overflow: hidden;
        place-items: center;
        border-radius: 5px;
        color: var(--accent);
        background: var(--primary);
    }

    .media-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .entry-copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        gap: 4px;
    }

    .entry-name {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .entry-detail {
        color: #c5b5b5;
        font-size: 0.78rem;
        text-transform: capitalize;
    }

    .entry-action {
        display: grid;
        flex: 0 0 26px;
        place-items: center;
        color: var(--accent);
    }

    .empty-state {
        width: 100%;
        align-self: center;
        margin: 0;
        padding: 28px 16px;
        color: #c5b5b5;
        text-align: center;
    }

    .message,
    .error-state {
        margin: 0;
        padding: 9px 14px;
        color: var(--text);
        background: var(--primary);
        font-size: 0.88rem;
    }

    .error-state {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: #fff0e2;
        background: #5f2727;
    }

    .error-state p {
        margin: 0;
    }

    .error-state button {
        flex: 0 0 auto;
        padding: 6px 10px;
    }

    .page-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 48px;
        padding: 6px 12px;
        border-top: 1px solid var(--primary-lighter);
        background: var(--primary-darker);
        font-size: 0.85rem;
        font-variant-numeric: tabular-nums;
    }

    .page-controls button {
        display: flex;
        align-items: center;
        gap: 5px;
        min-height: 34px;
        padding: 0 10px;
    }

    .spinner {
        width: 15px;
        height: 15px;
        border: 2px solid var(--primary-lighter);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (max-width: 560px) {
        .media-list {
            grid-template-columns: 1fr;
            gap: 6px;
            padding: 8px;
        }
    }
</style>
