<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { MAX_THUMBNAIL_BYTES, type RemoteMediaBreadcrumb, type RemoteMediaErrorCode, type RemoteMediaItem, type RemoteMediaPage, type RemoteMediaSelection } from "../../../types/remote/control"
    import Icon from "../../common/components/Icon.svelte"
    import { onResponse, send } from "../util/socket"
    import { active as activeContent, activeTab, isConnected } from "../util/stores"

    export let active = true
    export let tablet = false

    type PageRequest = { path: string; page: number; generation: number }
    type ThumbnailRequest = { path: string; generation: number }
    type Breadcrumb = RemoteMediaBreadcrumb

    let currentPath = ""
    let breadcrumbs: Breadcrumb[] = [{ path: "", name: "Media" }]
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
    $: pageData = pages.get(currentPage)
    $: selectedPath = $activeContent?.data?.remoteMedia?.item?.path || ""

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

    function openFolder(path: string, name?: string) {
        cancelBrowse()
        cancelThumbnails()
        generation += 1
        currentPath = path
        if (!path) breadcrumbs = [{ path: "", name: "Media" }]
        else {
            const existing = breadcrumbs.findIndex((breadcrumb) => breadcrumb.path === path)
            if (existing >= 0) breadcrumbs = breadcrumbs.slice(0, existing + 1)
            else breadcrumbs = [...breadcrumbs, { path, name: name || displayName(path) }]
        }
        currentPage = 0
        pages = new Map()
        errorMessage = ""
        actionMessage = ""
        requestPage(0)
    }

    function requestPage(page: number) {
        if (!$isConnected || loading) return

        const cursor = page > 0 ? pages.get(page - 1)?.nextCursor : undefined
        if (page > 0 && !cursor) {
            errorMessage = "This page is no longer available. Restart this folder to continue."
            return
        }

        const requestId = page === 0 ? makeRequestId() : lastBrowseRequestId
        if (!requestId) {
            errorMessage = "This folder listing expired. Restart this folder to continue."
            return
        }
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
        if (request.generation !== generation || request.path !== currentPath) {
            pendingBrowse.delete(data.requestId)
            return
        }
        // Pages in one cursor session share a request ID. Keep the current
        // operation pending if a late reply for a different page arrives.
        if (request.path !== data.path || request.page !== data.page) return
        pendingBrowse.delete(data.requestId)

        loading = false
        lastBrowseRequestId = data.requestId
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

    function selectMedia(item: RemoteMediaItem) {
        if (item.kind === "folder") return
        const previous = $activeContent?.data?.remoteMedia as RemoteMediaSelection | undefined
        const sameItem = previous?.item?.path === item.path
        const selection: RemoteMediaSelection = {
            item,
            location: breadcrumbs.map((breadcrumb) => breadcrumb.name).join(" / "),
            breadcrumbs,
            currentPath,
            thumbnail: thumbnails[item.path] || "",
            loop: sameItem ? previous.loop : false,
            muted: sameItem ? previous.muted : false
        }
        // Leaving the library tab cancels browsing. Cancel before the preview page mounts: Svelte 5 runs the new page's
        // thumbnail request before this component's own tab-change reaction, which would queue it behind the browse.
        if (!tablet) cancelBrowse()
        activeContent.set({
            id: item.path,
            type: item.kind,
            name: item.name,
            data: { remoteMedia: selection }
        })
        if (!tablet) activeTab.set("show")
    }

    function openBreadcrumb(index: number) {
        const breadcrumb = breadcrumbs[index]
        if (breadcrumb) openFolder(breadcrumb.path)
    }

    function formatSize(size: number) {
        if (!Number.isFinite(size) || size < 0) return ""
        if (size < 1_000) return `${size} B`
        if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} kB`
        return `${(size / 1_000_000).toFixed(1)} MB`
    }

    function displayName(path: string) {
        return path.split(/[\\/]/).filter(Boolean).pop() || "Media"
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
    })

    $: if (active && $isConnected && !started) {
        started = true
        const remoteMedia = $activeContent?.data?.remoteMedia as RemoteMediaSelection | undefined
        if (remoteMedia?.currentPath && Array.isArray(remoteMedia.breadcrumbs)) {
            currentPath = remoteMedia.currentPath
            breadcrumbs = remoteMedia.breadcrumbs
        }
        openFolder(currentPath)
    }

    $: if ((!active || !$isConnected) && started) {
        started = false
        generation += 1
        cancelBrowse()
        cancelThumbnails()
        if (!$isConnected) pendingThumbnails.clear()
    }

    onDestroy(() => {
        cancelBrowse()
        cancelThumbnails()
        unsubscribers.forEach((unsubscribe) => unsubscribe())
    })
</script>

<section class="media-library" aria-label="Media library">
    <header class="library-header">
        <h2>Media</h2>
        {#if !$isConnected}<span class="connection-state">Offline</span>{/if}
    </header>

    <nav class="breadcrumbs" aria-label="Media location">
        {#each breadcrumbs as breadcrumb, index (breadcrumb.path)}
            {#if index > 0}<span class="crumb-separator" aria-hidden="true">/</span>{/if}
            <button type="button" on:click={() => openBreadcrumb(index)} disabled={loading || index === breadcrumbs.length - 1} aria-current={index === breadcrumbs.length - 1 ? "location" : undefined}>
                {breadcrumb.name}
            </button>
        {/each}
    </nav>

    {#if actionMessage}
        <p class="message" role="status">{actionMessage}</p>
    {/if}
    {#if errorMessage}
        <div class="error-state" role="alert">
            <p>{errorMessage}</p>
            <button type="button" on:click={() => requestPage(currentPage)} disabled={loading || !$isConnected}>Try again</button>
        </div>
    {/if}

    <div class="media-results" aria-live="polite">
        {#if loading && !pageData}
            <p class="empty-state">Loading media…</p>
        {:else if pageData?.items.length}
            <div class="media-list">
                {#each pageData.items as item (item.path)}
                    <button class="media-entry" class:folder={item.kind === "folder"} class:selected={selectedPath === item.path} type="button" use:observeMedia={item} on:click={() => (item.kind === "folder" ? openFolder(item.path, item.name) : selectMedia(item))} disabled={loading} aria-label={item.kind === "folder" ? `Open folder ${item.name}` : `Preview ${item.name}`} aria-pressed={item.kind !== "folder" && selectedPath === item.path}>
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
                        <span class="entry-action">
                            {#if item.kind === "folder"}
                                <Icon id="next" size={1.2} />
                                <span>Open</span>
                            {:else if selectedPath === item.path}
                                <Icon id="check" size={1.1} />
                                <span>Previewing</span>
                            {:else}
                                <span>Preview</span>
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
                    This folder has no supported media files.
                {:else}
                    No media folders are available.
                {/if}
            </p>
        {:else if !$isConnected}
            <p class="empty-state">Connect to the presentation computer to browse media.</p>
        {:else if !loading && !errorMessage}
            <p class="empty-state">No media folders are available.</p>
        {/if}
    </div>

    {#if pageData}
        <footer class="page-controls">
            <button type="button" on:click={() => goToPage(currentPage - 1)} disabled={loading || currentPage === 0 || !$isConnected}>
                <Icon id="previous" size={1.1} /> Previous
            </button>
            <span>Page {currentPage + 1}</span>
            <button type="button" on:click={() => goToPage(currentPage + 1)} disabled={loading || !pageData.hasMore || !$isConnected}>
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
        color: var(--operator-text);
        background: var(--operator-canvas);
    }

    .library-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px 8px;
    }

    h2 {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 650;
    }

    .media-library button {
        font: inherit;
        color: inherit;
    }

    :global(.media-library button:focus-visible) {
        outline: 2px solid var(--operator-focus);
        outline-offset: 2px;
    }

    .connection-state {
        padding: 4px 8px;
        border-radius: 999px;
        color: var(--operator-text);
        background: var(--operator-raised);
        font-size: 0.82rem;
    }

    .breadcrumbs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px 4px;
        padding: 0 12px 10px;
    }

    .breadcrumbs button {
        min-height: 40px;
        padding: 4px 6px;
        border: 0;
        border-radius: 6px;
        color: var(--operator-muted);
        background: transparent;
        font-size: 0.88rem;
        text-align: left;
        overflow-wrap: anywhere;
    }

    .breadcrumbs button[aria-current="location"] {
        color: var(--operator-text);
        font-weight: 600;
    }

    .breadcrumbs button:not(:disabled):hover {
        background: var(--operator-raised);
        color: var(--operator-text);
    }

    .crumb-separator {
        color: var(--operator-muted);
        font-size: 0.85rem;
    }

    .media-library button:disabled {
        cursor: default;
        opacity: 0.52;
    }

    .media-results {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
    }

    .media-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
        align-content: start;
        gap: 8px;
        width: 100%;
        padding: 4px 12px 16px;
        box-sizing: border-box;
    }

    .media-entry {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        min-height: 72px;
        padding: 8px 12px;
        border: 1px solid var(--operator-border);
        border-radius: 10px;
        color: var(--operator-text);
        text-align: left;
        background: var(--operator-surface);
        cursor: pointer;
    }

    .media-entry:hover:not(:disabled) {
        background: var(--operator-raised);
    }

    .media-entry.selected {
        border-color: var(--operator-amber);
        background: var(--operator-raised);
    }

    .media-thumb {
        display: grid;
        flex: 0 0 56px;
        width: 56px;
        height: 52px;
        overflow: hidden;
        place-items: center;
        border-radius: 6px;
        color: var(--operator-amber);
        background: var(--operator-raised);
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
        color: var(--operator-muted);
        font-size: 0.875rem;
        text-transform: capitalize;
    }

    .entry-action {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        min-width: 70px;
        color: var(--operator-muted);
        font-size: 0.82rem;
        text-align: right;
    }

    .media-entry.selected .entry-action {
        color: var(--operator-amber);
    }

    .empty-state {
        width: 100%;
        align-self: center;
        margin: 0;
        padding: 32px 20px;
        color: var(--operator-muted);
        text-align: center;
    }

    .message,
    .error-state {
        margin: 0;
        padding: 10px 16px;
        color: var(--operator-text);
        background: var(--operator-surface);
        font-size: 0.9rem;
    }

    .error-state {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--operator-text);
        background: var(--operator-crimson);
    }

    .error-state p {
        margin: 0;
    }

    .error-state button {
        flex: 0 0 auto;
        min-height: 44px;
        padding: 0 12px;
        border: 1px solid var(--operator-border);
        border-radius: 8px;
        background: var(--operator-raised);
    }

    .page-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 56px;
        padding: 6px 12px max(6px, env(safe-area-inset-bottom));
        border-top: 1px solid var(--operator-border);
        background: var(--operator-surface);
        font-size: 0.9rem;
        font-variant-numeric: tabular-nums;
    }

    .page-controls button {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 104px;
        min-height: 44px;
        justify-content: center;
        padding: 0 10px;
        border: 1px solid var(--operator-border);
        border-radius: 8px;
        background: var(--operator-raised);
        cursor: pointer;
    }

    @media (max-width: 560px) {
        .breadcrumbs {
            gap: 0 2px;
            padding-inline: 10px;
        }

        .media-list {
            grid-template-columns: 1fr;
            gap: 8px;
            padding: 4px 10px 12px;
        }

        .media-entry {
            min-height: 68px;
            gap: 10px;
            padding-inline: 10px;
        }

        .entry-action {
            min-width: 66px;
        }
    }
</style>
