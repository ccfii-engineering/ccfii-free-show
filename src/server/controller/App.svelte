<script lang="ts">
    import { MAX_THUMBNAIL_BYTES, type ControllerPresenterPreview, type ControllerPresenterSnapshot } from "../../types/remote/control"
    import "../common/brand.css"
    import type { DrawTools } from "../../types/Draw"
    import type { ControllerClientProtocol, ControllerFocusRequest, ControllerResponses } from "../../types/controller/protocol"
    import { createWebClient } from "../common/util/webClient"
    import Brand from "../common/components/Brand.svelte"
    import Icon from "../common/components/Icon.svelte"
    import PresenterPreview from "./components/PresenterPreview.svelte"
    import { htmlToPlainText } from "../common/util/plainText"

    type PreviewData = ControllerPresenterPreview & { assets?: Record<string, string> }
    type PresenterState = Omit<ControllerPresenterSnapshot, "current" | "next"> & { current: PreviewData | null; next: PreviewData | null }
    type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected"

    const tools = ["Focus", "Pointer", "Zoom", "Particles", "Paint"]

    let connectionState: ConnectionState = "connecting"
    let hasConnected = false
    let presenterConnectionEpoch = 0
    let awaitingPresenterState = true
    let outputId = ""
    let presenterState: PresenterState | null = null
    let presenterThumbnails: Record<string, string> = {}
    let assetRevision = -1
    let assetQueue: string[] = []
    let pendingAssets = new Map<string, { revision: number; connectionEpoch: number }>()
    let thumbnailBytes = 0
    let aspectRatio = 16 / 9
    let thumbnailBackground = ""
    let thumbnailInterval: ReturnType<typeof setInterval> | null = null
    let frameReceived = true
    let justCleared: ReturnType<typeof setTimeout> | null = null
    let draw = false
    let pointerDown = false
    let activePointerId = -1
    let padElem: HTMLElement | undefined
    let tool = "Focus"

    $: presenterNotes = presenterState ? htmlToPlainText(presenterState.notes) : ""
    $: connected = connectionState === "connected"
    $: connectionLabel = connectionState[0].toUpperCase() + connectionState.slice(1)
    $: if (draw && connected && !thumbnailInterval) thumbnailInterval = setInterval(requestThumbnail, 800)
    else if ((!draw || !connected) && thumbnailInterval) {
        clearInterval(thumbnailInterval)
        thumbnailInterval = null
    }

    // The shared web client owns connect, reconnect and the offline rule: controls are never sent (or buffered)
    // while disconnected, and every (re)connect asks for the output id and a fresh presenter snapshot again.
    const client = createWebClient<ControllerClientProtocol, ControllerResponses>({
        event: "CONTROLLER",
        autoReady: true,
        onConnect: () => {
            hasConnected = true
            presenterConnectionEpoch += 1
            awaitingPresenterState = true
            connectionState = "connected"
            client.send("GET_OUTPUT_ID")
            client.send("PRESENTER_SUBSCRIBE")
        },
        onReconnectAttempt: () => {
            connectionState = "reconnecting"
        },
        onConnectError: () => {
            connectionState = hasConnected ? "reconnecting" : "connecting"
        },
        onDisconnect: (reason) => onDisconnected(reason)
    })
    client.start({
        OUTPUT_FRAME: (data) => {
            thumbnailBackground = data.frame || ""
            if (data.width && data.height) aspectRatio = data.width / data.height
            frameReceived = true
        },
        GET_OUTPUT_ID: (data) => {
            outputId = data || ""
        },
        PRESENTER_STATE: (data) => updatePresenterState(data as PresenterState),
        PRESENTER_THUMBNAIL_RESULT: (data) => receivePresenterThumbnail(data)
    })

    function onDisconnected(reason: string) {
        connectionState = reason === "io server disconnect" ? "disconnected" : hasConnected ? "reconnecting" : "connecting"
        outputId = ""
        awaitingPresenterState = true
        presenterConnectionEpoch += 1
        pointerDown = false
        pendingAssets.clear()
        assetQueue = presenterState ? [presenterState.current, presenterState.next].flatMap((preview) => Object.values(preview?.assets || {})) : []
    }

    function updatePresenterState(data: PresenterState) {
        if (!connected) return
        const isFirstStateInConnection = awaitingPresenterState
        if (!isFirstStateInConnection && presenterState && data.revision < presenterState.revision) return
        presenterState = data
        outputId = data.outputId || outputId
        awaitingPresenterState = false
        if (!isFirstStateInConnection && assetRevision === data.revision) {
            flushPresenterThumbnails()
            return
        }

        assetRevision = data.revision
        presenterThumbnails = {}
        thumbnailBytes = 0
        pendingAssets.clear()
        const assets = [data.current, data.next].flatMap((preview) => Object.values(preview?.assets || {}))
        assetQueue = Array.from(new Set(assets))
        flushPresenterThumbnails()
    }

    function flushPresenterThumbnails() {
        while (connected && presenterState && pendingAssets.size < 2 && assetQueue.length) {
            const assetId = assetQueue.shift()!
            if (pendingAssets.has(assetId) || presenterThumbnails[assetId] !== undefined) continue
            pendingAssets.set(assetId, { revision: presenterState.revision, connectionEpoch: presenterConnectionEpoch })
            client.send("PRESENTER_THUMBNAIL", { revision: presenterState.revision, assetId })
        }
    }

    function receivePresenterThumbnail(data: { revision: number; assetId: string; thumbnail: string }) {
        const pendingAsset = pendingAssets.get(data.assetId)
        if (awaitingPresenterState || !presenterState || data.revision !== presenterState.revision || !pendingAsset || pendingAsset.revision !== data.revision || pendingAsset.connectionEpoch !== presenterConnectionEpoch) return
        pendingAssets.delete(data.assetId)
        const size = data.thumbnail?.length || 0
        if (size && thumbnailBytes + size <= MAX_THUMBNAIL_BYTES) {
            presenterThumbnails = { ...presenterThumbnails, [data.assetId]: data.thumbnail }
            thumbnailBytes += size
        } else {
            presenterThumbnails = { ...presenterThumbnails, [data.assetId]: "" }
        }
        flushPresenterThumbnails()
    }

    function requestThumbnail() {
        if (!connected || !outputId || !frameReceived) return
        frameReceived = false
        client.send("OUTPUT_FRAME", { outputId })
    }

    function sendAction(id: string) {
        if (!connected) return
        client.send("ACTION", { id })

        if (justCleared) {
            clearTimeout(justCleared)
            justCleared = null
        } else if (id === "clear") {
            justCleared = setTimeout(() => (justCleared = null), 2000)
        }
    }

    function startDrawing(event: PointerEvent) {
        if (!connected || event.button !== 0 || !padElem) return
        // a second finger (or a resting palm) must not take the pointer away from the first
        if (pointerDown && event.pointerId !== activePointerId) {
            event.preventDefault()
            return
        }
        // touch: stop the browser from starting a text selection, scroll or zoom gesture on the surface
        event.preventDefault()
        activePointerId = event.pointerId
        try {
            padElem.setPointerCapture(event.pointerId)
        } catch {
            // synthetic or already released pointer: the window listeners still follow it
        }
        pointerDown = true
        sendPosition(event)
    }

    function stopDrawing(event?: PointerEvent) {
        if (!pointerDown || (event && event.pointerId !== activePointerId)) return
        pointerDown = false
        try {
            if (event && padElem?.hasPointerCapture(event.pointerId)) padElem.releasePointerCapture(event.pointerId)
        } catch {
            // already released
        }
        if (!connected) return

        const data: ControllerFocusRequest = { offset: null }
        if (tool === "Zoom") data.tool = null
        client.send("FOCUS", data)
    }

    function moveDrawing(event: PointerEvent) {
        if (!pointerDown || event.pointerId !== activePointerId) return
        sendPosition(event)
    }

    function sendPosition(event: PointerEvent) {
        if (!connected || !padElem) return

        const rect = padElem.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const offset = {
            x: Math.max(0, Math.min((event.clientX - rect.left) / rect.width, 1)),
            y: Math.max(0, Math.min((event.clientY - rect.top) / rect.height, 1))
        }
        client.send("FOCUS", { offset, tool: tool.toLowerCase() as DrawTools })
    }

    function blockSelection(event: Event) {
        if (pointerDown) event.preventDefault()
    }

    function changeTool(event: Event) {
        tool = (event.currentTarget as HTMLSelectElement).value
    }

    function keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || isEditingTarget(event.target)) return
        const target = event.target as HTMLElement | null
        const nativeActionTarget = target?.closest("button, a[href], [role='button']")
        if (nativeActionTarget && (event.key === " " || event.key === "Enter")) return

        const actions: Record<string, string> = {
            " ": "next",
            ArrowRight: "next",
            PageDown: "next",
            ArrowLeft: "previous",
            PageUp: "previous",
            Escape: "clear"
        }
        const action = actions[event.key]
        if (!action) return
        if (event.key === " " || event.key.startsWith("Arrow") || event.key.startsWith("Page")) event.preventDefault()
        sendAction(action)
    }

    function isEditingTarget(target: EventTarget | null) {
        if (!(target instanceof HTMLElement)) return false
        return target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable='true']")
    }

    function previewContext(preview: PreviewData | null | undefined, fallbackName?: string) {
        if (!preview) return fallbackName || ""
        const showName = preview.showName || fallbackName
        const slideNumber = preview.index + 1
        return showName ? `${showName}, slide ${slideNumber}` : `Slide ${slideNumber}`
    }

    function toggleDraw(enabled: boolean) {
        draw = enabled
        pointerDown = false
    }
</script>

<svelte:window on:keydown={keydown} on:pointerup={stopDrawing} on:pointercancel={stopDrawing} on:pointermove={moveDrawing} on:selectstart={blockSelection} />

<div class="controller-app">
    <header class="app-header">
        <div class="brand"><Brand role="Controller" compact /></div>
        <div class="header-status">
            <div class="connection" class:connected aria-live="polite" role="status">
                <span class="connection-dot" aria-hidden="true"></span>
                <span>{connectionLabel}</span>
            </div>
            {#if !connected || awaitingPresenterState}
                <p class="connection-message" class:stale={presenterState}>
                    {#if connectionState === "connecting"}
                        Connecting to the presentation controller.
                    {:else if connectionState === "reconnecting"}
                        Reconnecting. Controls are unavailable until the connection returns.
                    {:else if awaitingPresenterState && connected}
                        Connected. Waiting for fresh slide data.
                    {:else}
                        Disconnected. Controls are unavailable.
                    {/if}
                    {#if presenterState}<span> The last preview may be out of date.</span>{/if}
                </p>
            {/if}
        </div>
    </header>

    <main class="workspace" class:offline={!connected}>
        <section class="preview-grid" aria-label="Current and next slides">
            <section class="preview-panel" aria-labelledby="current-heading">
                <div class="preview-heading">
                    <h2 id="current-heading">Current</h2>
                    <span>{previewContext(presenterState?.current, presenterState?.showName) || (presenterState?.status === "cleared" ? "Output cleared" : "On screen")}</span>
                </div>
                {#if presenterState?.current}
                    <PresenterPreview preview={presenterState.current} thumbnails={presenterThumbnails} />
                {:else}
                    <div class="preview-frame preview-empty" role="img" aria-label={presenterState?.status === "cleared" ? "Output cleared" : "No active slide"}>
                        {presenterState?.status === "cleared" ? "Output cleared" : "No active slide"}
                    </div>
                {/if}
            </section>
            <section class="preview-panel" aria-labelledby="next-heading">
                <div class="preview-heading">
                    <h2 id="next-heading">Next</h2>
                    <span>{previewContext(presenterState?.next, presenterState?.showName) || (presenterState?.atEnd ? "End of show" : "No next slide preview")}</span>
                </div>
                {#if presenterState?.next}
                    <PresenterPreview preview={presenterState.next} thumbnails={presenterThumbnails} />
                {:else}
                    <div class="preview-frame preview-empty" role="img" aria-label={presenterState?.atEnd ? "End of show" : "No next slide preview"}>
                        {presenterState?.atEnd ? "End of show" : "No next slide preview"}
                    </div>
                {/if}
            </section>
        </section>

        <section class="presenter-notes" aria-labelledby="notes-heading">
            <h2 id="notes-heading">Notes</h2>
            <p>{presenterNotes || "No notes for this slide."}</p>
        </section>

        {#if draw}
            <section class="draw-panel" aria-label="Drawing tools">
                <div class="draw-toolbar">
                    <label for="drawing-tool">Drawing tool</label>
                    <select id="drawing-tool" name="tools" value={tool} on:change={changeTool}>
                        {#each tools as toolKey}
                            <option value={toolKey}>{toolKey}</option>
                        {/each}
                    </select>
                    {#if tool === "Paint"}
                        <button class="utility-button" disabled={!connected} on:click={() => sendAction("clear_painting")}>Clear drawing</button>
                    {/if}
                </div>
                <div bind:this={padElem} class="draw-surface" style={`--draw-aspect-ratio: ${thumbnailBackground ? aspectRatio : 16 / 9}`} on:contextmenu|preventDefault aria-label={`Drawing surface. Selected tool: ${tool}. ${thumbnailBackground ? "Output preview available." : "Output preview unavailable."}`} on:pointerdown={startDrawing}>
                    {#if thumbnailBackground}
                        <img src={thumbnailBackground} alt="Current output behind the drawing surface" draggable="false" />
                    {:else}
                        <span>Output preview unavailable. Drawing tools remain available.</span>
                    {/if}
                </div>
            </section>
        {/if}
    </main>

    <footer class="control-footer" aria-label="Presentation controls">
        <div class="action-row">
            <button class="action secondary" disabled={!connected} on:click={() => sendAction("previous")}>
                <Icon id="previous" size={1.25} />
                <span>Previous</span>
            </button>
            <button class="action primary" disabled={!connected} on:click={() => sendAction("next")}>
                <span>Next</span>
                <Icon id="next" size={1.25} />
            </button>
            <button class="action clear" class:recent={justCleared !== null} disabled={!connected} on:click={() => sendAction("clear")}>
                <Icon id="clear" size={1.15} />
                <span>Clear output</span>
            </button>
        </div>
        <div class="mode-row" role="group" aria-label="Controller mode">
            <button class:active={!draw} aria-pressed={!draw} on:click={() => toggleDraw(false)}>Show controls</button>
            <button class:active={draw} aria-pressed={draw} on:click={() => toggleDraw(true)}>Draw mode</button>
        </div>
    </footer>
</div>

<style>
    :global(*) {
        box-sizing: border-box;
    }

    :global(html) {
        min-width: 320px;
        min-height: 100%;
        background: var(--operator-canvas, #171513);
    }

    :global(body) {
        min-width: 320px;
        min-height: 100%;
        margin: 0;
        color: var(--operator-text, #f4f1ed);
        background: var(--operator-canvas, #171513);
        font-family:
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        font-size: 16px;
        -webkit-tap-highlight-color: transparent;
        -webkit-font-smoothing: antialiased;
    }

    :global(::selection) {
        color: var(--operator-canvas, #171513);
        background: var(--operator-amber, #faa739);
    }

    :global(button),
    :global(select) {
        font: inherit;
    }

    .controller-app {
        --footer-button-height: 48px;
        --pad-inline: 16px;
        width: min(100%, 1440px);
        height: 100vh;
        height: 100dvh;
        min-height: 480px;
        margin: 0 auto;
        padding: 14px var(--pad-inline) max(12px, env(safe-area-inset-bottom));
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: 12px;
    }

    .app-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 46px;
        gap: 16px;
    }

    .brand {
        min-width: 0;
    }

    .header-status {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        min-width: 0;
        gap: 2px;
    }

    .connection {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        flex: 0 0 auto;
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        font-size: 0.875rem;
        font-weight: 600;
    }

    .connection-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--operator-muted, rgb(244 241 237 / 72%));
    }

    .connection.connected .connection-dot {
        background: var(--operator-amber, #faa739);
    }

    .connection-message {
        max-width: 300px;
        margin: 0;
        padding: 0;
        color: var(--operator-amber, #faa739);
        font-size: 0.75rem;
        line-height: 1.4;
        text-align: right;
    }

    .connection-message.stale {
        color: var(--operator-muted, rgb(244 241 237 / 72%));
    }

    .workspace {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        overflow: auto;
        scrollbar-color: var(--operator-raised, #2c2824) transparent;
        scrollbar-width: thin;
    }

    .preview-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }

    .preview-panel {
        min-width: 0;
        padding: 10px;
        border: 1px solid var(--operator-border, rgb(244 241 237 / 14%));
        border-radius: 12px;
        background: var(--operator-surface, #211e1b);
    }

    .preview-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        min-height: 30px;
        gap: 12px;
    }

    .preview-heading h2,
    .presenter-notes h2 {
        margin: 0;
        color: var(--operator-text, #f4f1ed);
        font-size: 0.95rem;
        font-weight: 650;
    }

    .preview-heading span {
        min-width: 0;
        overflow: hidden;
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        font-size: 0.82rem;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .preview-panel :global(.preview-frame) {
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 7px;
        background: var(--operator-preview, #070707);
    }

    .preview-panel .preview-empty {
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        font-size: 0.9rem;
        text-align: center;
    }

    .presenter-notes {
        flex: 1 1 110px;
        min-height: 88px;
        overflow: auto;
        padding: 12px 14px;
        border: 1px solid var(--operator-border, rgb(244 241 237 / 14%));
        border-radius: 12px;
        background: var(--operator-surface, #211e1b);
        scrollbar-color: var(--operator-raised, #2c2824) transparent;
        scrollbar-width: thin;
    }

    .presenter-notes h2 {
        margin-bottom: 6px;
        color: var(--operator-amber, #faa739);
    }

    .presenter-notes p {
        max-width: 75ch;
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--operator-text, #f4f1ed);
        font-size: 0.95rem;
        line-height: 1.45;
        white-space: pre-wrap;
        user-select: text;
    }

    .draw-panel {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--operator-border, rgb(244 241 237 / 14%));
        border-radius: 12px;
        background: var(--operator-surface, #211e1b);
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
    }

    .draw-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }

    .draw-toolbar label {
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        font-size: 0.875rem;
        font-weight: 600;
    }

    .draw-toolbar select,
    .utility-button {
        min-height: 44px;
        padding: 0 12px;
        border: 1px solid var(--operator-border, rgb(244 241 237 / 14%));
        border-radius: 8px;
        color: var(--operator-text, #f4f1ed);
        background: var(--operator-raised, #2c2824);
    }

    .draw-toolbar select {
        min-width: 140px;
    }

    .utility-button {
        cursor: pointer;
    }

    .draw-surface {
        position: relative;
        display: grid;
        width: min(100%, 920px, calc(50dvh * var(--draw-aspect-ratio)));
        aspect-ratio: var(--draw-aspect-ratio);
        max-height: 50dvh;
        margin: 0 auto;
        overflow: hidden;
        place-items: center;
        border-radius: 8px;
        background: var(--operator-preview, #070707);
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
    }

    .draw-surface img {
        position: absolute;
        width: 100%;
        height: 100%;
        object-fit: fill;
        opacity: 0.56;
        pointer-events: none;
    }

    .draw-surface span {
        z-index: 1;
        padding: 20px;
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        text-align: center;
    }

    .control-footer {
        width: min(100%, 1240px);
        margin: 0 auto;
        padding: 10px;
        border: 1px solid var(--operator-border, rgb(244 241 237 / 14%));
        border-radius: 14px;
        background: var(--operator-surface, #211e1b);
    }

    .action-row,
    .mode-row {
        display: flex;
        justify-content: center;
        gap: 8px;
    }

    .mode-row {
        margin-top: 8px;
    }

    .action,
    .mode-row button {
        min-width: 0;
        height: var(--footer-button-height);
        min-height: var(--footer-button-height);
        display: inline-flex;
        white-space: nowrap;
        line-height: 1.2;
        align-items: center;
        justify-content: center;
        gap: 9px;
        padding: 0 18px;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--operator-text, #f4f1ed);
        font-size: 0.94rem;
        font-weight: 650;
        cursor: pointer;
        touch-action: manipulation;
        transition:
            background-color 120ms ease,
            border-color 120ms ease,
            color 120ms ease;
    }

    .action {
        flex: 1 1 0;
        max-width: 245px;
    }

    .action.secondary {
        border-color: var(--operator-border, rgb(244 241 237 / 14%));
        background: var(--operator-raised, #2c2824);
    }

    .action.primary {
        color: var(--operator-on-amber, #211506);
        background: var(--operator-amber, #faa739);
    }

    .action.clear {
        border-color: var(--operator-crimson, #810e0e);
        background: var(--operator-crimson, #810e0e);
    }

    .action.clear.recent {
        background: var(--operator-crimson-strong, #9b2424);
    }

    .mode-row button {
        flex: 0 1 240px;
        border-color: var(--operator-border, rgb(244 241 237 / 14%));
        color: var(--operator-muted, rgb(244 241 237 / 72%));
        background: transparent;
        font-size: 0.875rem;
        font-weight: 550;
    }

    .mode-row button.active {
        border-color: var(--operator-amber, #faa739);
        color: var(--operator-text, #f4f1ed);
        background: var(--operator-raised, #2c2824);
    }

    button:disabled {
        opacity: 0.48;
        cursor: not-allowed;
    }

    button:focus-visible,
    select:focus-visible {
        outline: 3px solid var(--operator-amber, #faa739);
        outline-offset: 2px;
    }

    button:not(:disabled):hover {
        border-color: var(--operator-amber, #faa739);
    }

    button:not(:disabled):active {
        transform: translateY(1px);
    }

    @media (min-width: 768px) {
        .controller-app {
            --pad-inline: 24px;
            padding-top: 20px;
            padding-bottom: max(18px, env(safe-area-inset-bottom));
            gap: 16px;
        }

        .preview-panel {
            padding: 12px;
        }

        .preview-heading {
            min-height: 34px;
        }

        .presenter-notes {
            min-height: 96px;
            max-height: min(180px, 24vh);
            padding: 14px 18px;
        }

        .control-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 10px 12px;
        }

        .action-row {
            flex: 1 1 auto;
        }

        .mode-row {
            flex: 0 0 auto;
            margin-top: 0;
        }

        .mode-row button {
            min-width: 132px;
        }
    }

    @media (max-width: 600px) {
        .controller-app {
            --pad-inline: 12px;
            min-height: 560px;
            gap: 8px;
            padding-top: 8px;
        }

        .app-header {
            min-height: 42px;
        }

        .preview-grid {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }

        .preview-panel {
            padding: 8px;
            border-radius: 10px;
        }

        .preview-heading {
            min-height: 27px;
        }

        .preview-heading h2,
        .presenter-notes h2 {
            font-size: 0.92rem;
        }

        .preview-heading span {
            font-size: 0.78rem;
        }

        .presenter-notes {
            flex: 0 1 auto;
            min-height: 76px;
            max-height: 120px;
            padding: 10px 12px;
        }

        .presenter-notes p {
            font-size: 0.9rem;
        }

        .control-footer {
            padding: 8px;
            border-radius: 12px;
        }

        .action-row,
        .mode-row {
            gap: 8px;
        }

        .action {
            flex-direction: column;
            gap: 1px;
            padding: 4px 4px;
            font-size: 0.76rem;
        }

        .action :global(svg) {
            width: 18px !important;
            height: 18px !important;
            min-width: 18px !important;
        }

        .mode-row button {
            flex: 1 1 0;
            padding: 0 8px;
            font-size: 0.82rem;
        }

        .draw-toolbar {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
        }

        .draw-toolbar select {
            min-width: 0;
            width: 100%;
        }

        .utility-button {
            padding: 0 9px;
            font-size: 0.82rem;
        }
    }

    @media (max-height: 680px) and (min-width: 601px) {
        .controller-app {
            --footer-button-height: 44px;
            min-height: 0;
            padding-top: 8px;
            padding-bottom: max(8px, env(safe-area-inset-bottom));
            gap: 8px;
        }

        .preview-panel {
            padding: 8px;
        }

        .presenter-notes {
            flex: 1 1 68px;
            min-height: 68px;
            max-height: none;
            padding: 8px 12px;
        }

        .preview-panel :global(.preview-frame) {
            width: min(100%, calc(50svh * 16 / 9));
            margin-inline: auto;
        }

        .control-footer {
            padding: 6px 8px;
        }

        .mode-row {
            margin-top: 0;
        }
    }

    @media (max-height: 430px) and (min-width: 601px) {
        .preview-heading {
            min-height: 32px;
        }

        .preview-panel :global(.preview-frame) {
            width: min(100%, calc(30svh * 16 / 9));
        }

        .presenter-notes {
            min-height: 80px;
        }

        .presenter-notes p {
            font-size: 0.88rem;
            line-height: 1.3;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
        }
    }
</style>
