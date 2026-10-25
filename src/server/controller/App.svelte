<script lang="ts">
    import type { ControllerPresenterPreview, ControllerPresenterSnapshot } from "../../types/remote/control"
    import "../common/brand.css"
    import { io } from "socket.io-client"
    import Brand from "../common/components/Brand.svelte"
    import Icon from "../common/components/Icon.svelte"
    import PresenterPreview from "./components/PresenterPreview.svelte"
    import { htmlToPlainText } from "../common/util/plainText"

    type PreviewData = ControllerPresenterPreview & { assets?: Record<string, string> }
    type PresenterState = Omit<ControllerPresenterSnapshot, "current" | "next"> & { current: PreviewData | null; next: PreviewData | null }

    let socket = io()

    console.log(socket)

    let outputId: string = ""
    let presenterState: PresenterState | null = null
    let presenterThumbnails: Record<string, string> = {}
    let assetRevision = -1
    let assetQueue: string[] = []
    let pendingAssets = new Set<string>()
    let thumbnailBytes = 0
    const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024

    $: presenterNotes = presenterState ? htmlToPlainText(presenterState.notes) : ""

    socket.on("connect", () => {
        // id = socket.id
        socket.emit("CONTROLLER", { channel: "GET_OUTPUT_ID" })
        socket.emit("CONTROLLER", { channel: "PRESENTER_SUBSCRIBE" })
    })

    let aspectRatio = 16 / 9
    let thumbnailBackground: string = ""

    socket.on("CONTROLLER", (msg) => {
        if (msg.channel !== "OUTPUT_FRAME") console.log("MESSAGE:", msg)
        switch (msg.channel) {
            case "OUTPUT_FRAME":
                thumbnailBackground = msg.data.frame || ""
                if (msg.data.width && msg.data.height) aspectRatio = msg.data.width / msg.data.height
                frameReceived = true
                break
            case "GET_OUTPUT_ID":
                outputId = msg.data
                break
            case "PRESENTER_STATE":
                updatePresenterState(msg.data)
                break
            case "PRESENTER_THUMBNAIL_RESULT":
                receivePresenterThumbnail(msg.data)
                break
        }
    })

    socket.on("disconnect", () => {
        outputId = ""
        presenterState = null
        presenterThumbnails = {}
        assetQueue = []
        pendingAssets.clear()
        thumbnailBytes = 0
        assetRevision = -1
    })

    function updatePresenterState(data: PresenterState) {
        if (presenterState && data.revision < presenterState.revision) return
        presenterState = data
        outputId = data.outputId || outputId
        if (assetRevision === data.revision) return

        assetRevision = data.revision
        presenterThumbnails = {}
        thumbnailBytes = 0
        pendingAssets.clear()
        const assets = [data.current, data.next].flatMap((preview) => Object.values(preview?.assets || {}))
        assetQueue = Array.from(new Set(assets))
        flushPresenterThumbnails()
    }

    function flushPresenterThumbnails() {
        while (presenterState && pendingAssets.size < 2 && assetQueue.length) {
            const assetId = assetQueue.shift()!
            if (pendingAssets.has(assetId) || presenterThumbnails[assetId] !== undefined) continue
            pendingAssets.add(assetId)
            socket.emit("CONTROLLER", {
                channel: "PRESENTER_THUMBNAIL",
                data: { revision: presenterState.revision, assetId }
            })
        }
    }

    function receivePresenterThumbnail(data: { revision: number; assetId: string; thumbnail: string }) {
        if (!presenterState || data.revision !== presenterState.revision || !pendingAssets.has(data.assetId)) return
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

    let thumbnailInterval: any = null
    let frameReceived = true
    $: if (draw && !thumbnailInterval) thumbnailInterval = setInterval(requestThumbnail, 800)
    else if (thumbnailInterval) {
        clearInterval(thumbnailInterval)
        thumbnailInterval = null
    }

    function requestThumbnail() {
        if (!outputId || !frameReceived) return
        frameReceived = false
        socket.emit("CONTROLLER", { channel: "OUTPUT_FRAME", data: { outputId } })
    }

    function sendAction(id: string) {
        socket.emit("CONTROLLER", { channel: "ACTION", data: { id } })

        if (justCleared) {
            clearTimeout(justCleared)
            justCleared = null
        } else if (id === "clear") {
            justCleared = setTimeout(() => (justCleared = null), 2000)
        }
    }

    let justCleared: any = null

    let draw = false
    let mouseDown = false
    function mousedown() {
        mouseDown = true
    }
    function mouseup() {
        if (!mouseDown) return
        mouseDown = false

        let data: any = { offset: null }
        if (tool === "Zoom") data.tool = null

        socket.emit("CONTROLLER", {
            channel: "FOCUS",
            data
        })
    }

    let padElem: HTMLElement | undefined
    function mousemove(e: any) {
        if (!mouseDown || !padElem) return

        var elemRect = padElem.getBoundingClientRect()
        var x = (e.pageX ?? e.targetTouches[0].pageX) - elemRect.left
        var y = (e.pageY ?? e.targetTouches[0].pageY) - elemRect.top

        let offset = { x: x / elemRect.width, y: y / elemRect.height }
        offset = {
            x: Math.max(0, Math.min(offset.x, 1)),
            y: Math.max(0, Math.min(offset.y, 1))
        }

        socket.emit("CONTROLLER", {
            channel: "FOCUS",
            data: { offset, tool: tool.toLowerCase() }
        })
    }

    const tools: string[] = ["Focus", "Pointer", "Zoom", "Particles", "Paint"]
    let tool = "Focus"
    function changeTool(e: any) {
        tool = e.target.value
    }

    // keyboard shortcuts
    function keydown(e: KeyboardEvent) {
        if ([" ", "Arrow", "Page"].includes(e.key)) e.preventDefault()

        if ([" ", "ArrowRight", "PageDown"].includes(e.key)) sendAction("next")
        else if (["ArrowLeft", "PageUp"].includes(e.key)) sendAction("previous")
        else if (e.key === "Escape") sendAction("clear")
    }

    let windowHeight: number = 0
</script>

<svelte:window bind:innerHeight={windowHeight} on:keydown={keydown} on:mouseup={mouseup} on:touchend={mouseup} on:mousemove={mousemove} on:touchmove={mousemove} />

<div class="operator-brand">
    <Brand role="Controller" compact />
</div>

<section class="presenter-context" aria-label="Presenter view">
    <div class="preview-grid">
        <section class="preview-panel">
            <div class="preview-heading"><strong>Current</strong><span>{presenterState?.showName || (presenterState?.status === "cleared" ? "Output cleared" : "On screen")}</span></div>
            {#if presenterState?.current}
                <PresenterPreview preview={presenterState.current} thumbnails={presenterThumbnails} />
            {:else}
                <div class="preview-frame preview-empty">{presenterState?.status === "cleared" ? "Output cleared" : "No active slide"}</div>
            {/if}
        </section>
        <section class="preview-panel">
            <div class="preview-heading"><strong>Next</strong><span>{presenterState?.next?.showName || "Coming up"}</span></div>
            {#if presenterState?.next}
                <PresenterPreview preview={presenterState.next} thumbnails={presenterThumbnails} />
            {:else}
                <div class="preview-frame preview-empty">{presenterState?.atEnd ? "End of show" : "No next slide"}</div>
            {/if}
        </section>
    </div>
    <section class="presenter-notes" aria-label="Current slide notes">
        <strong>Notes</strong>
        <p>{presenterNotes || "No notes for this slide."}</p>
    </section>
</section>

{#if draw}
    <div class="draw">
        <select name="tools" value={tool} on:change={changeTool}>
            {#each tools as toolKey}
                <option value={toolKey}>{toolKey}</option>
            {/each}
        </select>

        <div bind:this={padElem} class="pad" style="aspect-ratio: {thumbnailBackground ? aspectRatio : 1};" on:mousedown={mousedown} on:touchstart={mousedown}>
            {#if thumbnailBackground}
                <div class="thumbnail">
                    <!-- object-fit: {thumbnailBackground.mediaStyle?.fit || 'contain'}; -->
                    <img src={thumbnailBackground} alt="" style="width: 100%;height: 100%;object-fit: fill;opacity: 0.5;" />
                </div>
            {/if}
        </div>

        {#if tool === "Paint"}
            <button on:click={() => sendAction("clear_painting")} title="Clear painting">
                <Icon id="clear" size={2} white right />
            </button>
        {/if}
    </div>
{:else}
    <div class="controller">
        <button class="quart" aria-label="Previous slide" on:click={() => sendAction("previous")}>
            <Icon id="previous" size={4} />
        </button>
        <button class="quart" aria-label="Next slide" on:click={() => sendAction("next")}>
            <Icon id="next" size={4} />
        </button>
        <!-- <button class="quart" />
  <button class="quart" /> -->
        <button class="center" class:red={justCleared} aria-label="Clear output" on:click={() => sendAction("clear")}>
            <Icon id="clear" size={4} white />
            <!-- <Icon id={justCleared ? "clear" : "slide"} size={4} white /> -->
        </button>
    </div>
{/if}

{#if windowHeight < 300}
    <div class="toggle-single">
        <button on:click={() => (draw = !draw)} title="Toggle draw mode">
            <Icon id={draw ? "pad" : "draw"} size={2} white />
        </button>
    </div>
{:else}
    <div class="toggles">
        <button on:click={() => (draw = false)} class="noright" style={draw ? "background-color: var(--primary-darker);" : ""}>
            <Icon id="pad" size={2.5} white={draw === true} />
        </button>
        <button on:click={() => (draw = true)} class="noleft" style={draw ? "" : "background-color: var(--primary-darker);"}>
            <Icon id="draw" size={2.5} white={draw === false} />
        </button>
    </div>
{/if}

<style>
    :global(*) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        user-select: none;

        outline-offset: -4px;
        outline-color: var(--accent);
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        background-color: var(--primary);
        color: var(--text);
        /* transition: background-color 0.5s; */
        -webkit-tap-highlight-color: transparent;

        font-family: var(--font-family);
        font-size: 1.5em;

        height: 100%;
        /* width: 100vw;
  height: 100vh; */
    }

    :root {
        /* --navigation-width: 18vw; */
        --navigation-width: 300px;
    }

    .operator-brand {
        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 20;
        pointer-events: none;
    }

    .presenter-context {
        position: absolute;
        z-index: 1;
        top: 58px;
        right: 12px;
        left: 12px;
        display: flex;
        flex-direction: column;
        max-width: 840px;
        margin: 0 auto;
        gap: 6px;
        pointer-events: none;
    }

    .preview-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }

    .preview-panel {
        min-width: 0;
        overflow: hidden;
        padding: 6px;
        border: 1px solid var(--primary-lighter);
        border-radius: 8px;
        background: var(--primary-darker);
    }

    .preview-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 2px 5px;
        font-size: 0.72rem;
    }

    .preview-heading strong,
    .presenter-notes strong {
        color: var(--accent);
        font-size: 0.68rem;
        text-transform: uppercase;
    }

    .preview-heading span {
        overflow: hidden;
        color: var(--text);
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .presenter-context :global(.preview-frame) {
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 5px;
        background: #000;
    }

    .presenter-context .preview-empty {
        display: grid;
        place-items: center;
        color: #c5b5b5;
        font-size: 0.78rem;
    }

    .presenter-notes {
        overflow: auto;
        min-height: 86px;
        max-height: 128px;
        flex: 0 0 auto;
        padding: 5px 8px;
        border: 1px solid var(--primary-lighter);
        border-radius: 7px;
        color: var(--text);
        background: var(--primary-darker);
        font-size: 0.74rem;
        pointer-events: auto;
    }

    .presenter-notes p {
        margin: 2px 0 0;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        line-height: 1.25;
    }

    :global(svg.white) {
        fill: var(--text) !important;
    }

    /* toggle */
    .toggle-single {
        position: absolute;
        bottom: 10px;
        left: 10px;
        z-index: 10;
    }
    .toggle-single button {
        width: 35px;
        height: 35px;
        padding: 5px;
        border-radius: 5px;
        background-color: var(--primary-darkest);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .toggles {
        position: absolute;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        width: 80vw;
        display: flex;
        /* gap: 10px; */
    }
    .toggles button,
    select {
        padding: 10px;
        color: var(--text);
        width: 100%;
        text-transform: uppercase;
        font-size: 0.8em;
        border-radius: 5px;
        display: flex;
        justify-content: center;
    }
    select {
        width: 80vw;
        background-color: var(--primary-darkest);
        border: none;
        text-align: center;
        font-weight: bold;
    }

    .toggles .noleft {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
    }
    .toggles .noright {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
    }

    /* pad */
    .draw {
        position: absolute;
        top: 60%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
    }

    .pad {
        height: min(55vw, 42vh);
        /* width: 80vw; */
        border-radius: 5px;
        background-color: var(--primary-darkest);
        touch-action: none;
        align-self: center;

        position: relative;
    }

    .thumbnail {
        pointer-events: none;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    }

    /* controller */
    .controller {
        position: absolute;
        top: 74%;
        left: 50%;
        transform: translate(-50%, -50%);
        /* transform: translate(-50%, -50%) rotate(45deg); */

        height: min(34vw, 32vh, 300px);
        width: min(34vw, 32vh, 300px);
        border-radius: 50%;
        overflow: hidden;
    }

    @media only screen and (max-width: 550px) {
        .presenter-context {
            max-width: 420px;
        }
        .preview-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        .presenter-notes {
            min-height: 76px;
            max-height: 92px;
        }
        .controller {
            top: 82%;
            height: min(38vw, 18vh, 160px);
            width: min(38vw, 18vh, 160px);
        }
        .toggles {
            bottom: 12px;
        }
    }
    @media only screen and (min-width: 620px) {
        .pad {
            height: 55vh;
            /* width: 55vh; */
        }
    }
    @media (max-height: 700px) {
        .controller {
            top: 76%;
            height: min(34vw, 28vh, 260px);
            width: min(34vw, 28vh, 260px);
        }
        .controller :global(svg) {
            width: 2.5rem !important;
            height: 2.5rem !important;
            min-width: 2.5rem !important;
        }
        .draw {
            top: 62%;
        }
        .pad {
            height: 40vh;
        }
        .toggles {
            bottom: 20px;
            height: 35px;
            width: 80vw;
        }
        .toggles button,
        select {
            padding: 5px;
            font-size: 0.7em;
        }
        .toggles :global(svg) {
            height: 1.5rem;
            width: 1.5rem !important;
            min-width: 1.5rem !important;
        }
    }

    /* (orientation: landscape) for wider devices */
    @media (min-width: 600px) and (max-height: 700px) {
        .controller {
            height: min(30vw, 25vh, 240px);
            width: min(30vw, 25vh, 240px);
        }
        .controller :global(svg) {
            width: 3.5rem !important;
            height: 3.5rem !important;
            min-width: 3.5rem !important;
        }
        .pad {
            height: 45vh;
        }
        .toggles {
            width: 60vw;
        }
    }

    @media (max-height: 299px) {
        .controller {
            top: 50%;
            height: min(34vw, 48vh, 180px);
            width: min(34vw, 48vh, 180px);
        }
        .controller :global(svg) {
            width: 3rem !important;
            height: 3rem !important;
            min-width: 3rem !important;
        }
        .draw {
            top: 50%;
        }
    }

    @media only screen and (min-width: 551px) {
        .presenter-notes {
            min-height: 92px;
        }
    }

    .quart {
        position: absolute;
        /* height: 50%; */
        height: 100%;
        width: 50%;
        /* transition: all 0.4s; */
    }
    .quart:nth-child(1) {
        top: 0;
        left: 0;
        border-inline-end: 5px solid var(--primary);
    }
    .quart:nth-child(1) :global(svg) {
        transform: translate(-40%);
    }
    .quart:nth-child(2) {
        top: 0;
        left: 50%;
        border-inline-start: 5px solid var(--primary);
    }
    .quart:nth-child(2) :global(svg) {
        transform: translate(40%);
    }
    /* .quart:nth-child(3) {
    top: 50%;
    left: 0;
  }
  .quart:nth-child(4) {
    top: 50%;
    left: 50%;
  } */
    .center {
        height: 40%;
        width: 40%;
        position: absolute;
        top: 30%;
        inset-inline-start: 30%;
        border-radius: 50%;
        text-align: center;
        border: 10px solid var(--primary);
    }

    button {
        display: flex;
        align-items: center;
        justify-content: center;

        border: none;
        cursor: pointer;
        padding: 5px;
        border-radius: 5px;
        background-color: var(--primary-darkest);

        transition: background-color 0.1s;
    }
    button:active {
        background: var(--primary-lighter);
    }

    button.red {
        background-color: var(--secondary);
    }
</style>
