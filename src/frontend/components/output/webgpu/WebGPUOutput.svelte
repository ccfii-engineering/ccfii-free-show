<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { OUTPUT } from "../../../../types/Channels"
    import type { OutData } from "../../../../types/Output"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, OutSlide, Slide, SlideData } from "../../../../types/Show"
    import { allOutputs, currentWindow, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../../stores"
    import { send } from "../../../utils/request"
    import { clone } from "../../helpers/array"
    import { getMediaStyle } from "../../helpers/media"
    import { defaultLayers, getCurrentStyle, getMetadata, getOutputLines, getOutputResolution, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../../helpers/output"
    import { _show } from "../../helpers/shows"
    import Zoomed from "../../slide/Zoomed.svelte"
    import SlideContent from "../layers/SlideContent.svelte"
    import Overlay from "../layers/Overlay.svelte"
    import Overlays from "../layers/Overlays.svelte"

    export let outputId = ""
    export let style = ""

    let canvas: HTMLCanvasElement
    let pixiApp: any = null
    let layerMgr: any = null
    let rendererMod: any = null
    let layerMgrMod: any = null
    let pixiReady = false
    let timeSendingTimeout: NodeJS.Timeout | null = null
    // deferred-clear timers — absorb transient null states in the reactive chain between same-media slides
    let slideBgClearTimer: NodeJS.Timeout | null = null
    let styleBgClearTimer: NodeJS.Timeout | null = null
    const CLEAR_DEBOUNCE_MS = 120

    // --- Store reads (wrapped in try/catch via reactive guards) ---
    $: currentOutput = $outputs[outputId] || $allOutputs[outputId] || {}
    $: currentStyling = getCurrentStyle($styles, currentOutput?.style || "")
    let currentStyle: Styles = { name: "" }
    $: if (currentStyling && JSON.stringify(currentStyling) !== JSON.stringify(currentStyle)) currentStyle = clone(currentStyling)

    let layers: string[] = []
    let out: OutData = {}
    let slide: OutSlide | null = null
    let background: OutBackground | null = null
    let clonedOverlays: any = null

    $: if (currentOutput) {
        const newLayers = currentStyle?.layers || defaultLayers
        if (JSON.stringify(layers) !== JSON.stringify(newLayers)) {
            layers = clone(Array.isArray(newLayers) ? newLayers : defaultLayers)
        }
    }
    $: {
        const newOut = currentOutput?.out || {}
        if (JSON.stringify(out) !== JSON.stringify(newOut)) out = clone(newOut)
    }
    $: {
        const newSlide = out?.slide || null
        if (JSON.stringify(slide) !== JSON.stringify(newSlide)) slide = clone(newSlide)
    }
    $: {
        const newBg = out?.background || null
        if (JSON.stringify(background) !== JSON.stringify(newBg)) background = clone(newBg)
    }

    // Overlays
    $: {
        const newIds = JSON.stringify(out?.overlays)
        if (newIds !== JSON.stringify(clonedOverlays ? Object.keys(clonedOverlays) : [])) {
            clonedOverlays = clone($overlays)
        }
    }
    $: outOverlays = (out?.overlays || []).filter((id: string) => !clonedOverlays?.[id]?.placeUnderSlide)
    $: outUnderlays = (out?.overlays || []).filter((id: string) => clonedOverlays?.[id]?.placeUnderSlide)

    // Layout & slide data
    let slideData: SlideData | null = null
    let currentSlide: Slide | null = null
    $: {
        if (!slide) {
            slideData = null
            currentSlide = null
        } else {
            try {
                const layout = clone(_show(slide.id).layouts([slide.layout]).ref()[0] || [])
                slideData = layout[slide?.index]?.data || null
                if (slide.id === "temp" || slide.id === "tempText") {
                    currentSlide = { items: slide.tempItems } as any
                } else {
                    const slideId = layout[slide?.index]?.id || ""
                    const newSlide = clone(_show(slide.id).slides([slideId]).get()[0] || null)
                    if (JSON.stringify(newSlide) !== JSON.stringify(currentSlide)) currentSlide = newSlide
                }
            } catch (e) {
                slideData = null
                currentSlide = null
            }
        }
    }

    // Transitions — use actual pixel resolution with style aspect ratio applied
    $: resolution = getOutputResolution(outputId, $outputs, true)
    $: transitions = getOutputTransitions(slideData, currentStyle?.transition, $transitionData, false)

    // stable reference that only changes when the *media* transition's content actually changes —
    // prevents text/overlay transition edits from re-running the media-update reactive blocks below
    let mediaTransition: any = {}
    $: {
        const next = transitions?.media || {}
        if (JSON.stringify(next) !== JSON.stringify(mediaTransition)) mediaTransition = next
    }
    $: mediaBackgroundDuration = mediaTransition?.type === "none" ? 0 : (mediaTransition?.duration ?? 800)

    // Template
    let styleTemplate: any = null
    $: if (currentStyle && currentSlide !== undefined) {
        try {
            if (currentSlide && slide) currentSlide.items = setTemplateStyle(slide, currentStyle, currentSlide.items, outputId, currentSlide.customDynamicValues)
            if (slide) styleTemplate = getStyleTemplate(slide, currentStyle)
        } catch {}
    }
    $: templateBackground = styleTemplate?.settings?.backgroundPath || ""

    // Lines
    let lines: any = {}
    $: currentLineId = slide?.id
    $: if (currentLineId && slide) {
        try {
            setTimeout(() => {
                lines[currentLineId!] = getOutputLines(slide!, currentStyle?.lines)
            }, 50)
        } catch {}
    }

    // Metadata
    $: metadataItems = getMetadata($showsCache[(slide as any)?.id || ""], currentStyle, slide, $templates)
    let currentMetadataItems: any[] = []
    let isMetadataClearing = false
    $: if (metadataItems !== null) {
        isMetadataClearing = false
        if (JSON.stringify(metadataItems) !== JSON.stringify(currentMetadataItems)) currentMetadataItems = clone(metadataItems)
    } else {
        isMetadataClearing = true
        setTimeout(() => {
            currentMetadataItems = []
        })
    }

    // Background data
    $: backgroundColor = currentOutput?.transparent ? "transparent" : styleTemplate?.settings?.backgroundColor || currentSlide?.settings?.color || currentStyle?.background || "black"
    $: styleBackground = currentStyle?.clearStyleBackgroundOnText && (slide || background) ? "" : currentStyle?.backgroundImage || ""
    $: defaultFit = currentStyle?.fit || "contain"
    $: styleBackgroundMediaStyle = styleBackground ? getMediaStyle($media[styleBackground], currentStyle) : null
    $: styleBackgroundData = styleBackground ? { path: styleBackground, ...($media[styleBackground] || {}), fit: styleBackgroundMediaStyle?.fit || defaultFit, loop: true } : null
    $: templateBackgroundMediaStyle = templateBackground ? getMediaStyle($media[templateBackground], currentStyle) : null
    $: templateBackgroundData = templateBackground ? { path: templateBackground, loop: true, ...($media[templateBackground] || {}), fit: templateBackgroundMediaStyle?.fit || defaultFit } : null
    $: backgroundMediaData = background?.path ? { ...($media[background.path] || {}), ...background } : background
    $: backgroundMediaStyle = backgroundMediaData ? getMediaStyle(backgroundMediaData, currentStyle) : null
    $: resolvedBackgroundData = backgroundMediaData ? { ...backgroundMediaData, fit: backgroundMediaStyle?.fit || defaultFit } : null
    $: backgroundData = templateBackground ? templateBackgroundData : resolvedBackgroundData

    $: overlaysActive = !!(layers.includes("overlays") && clonedOverlays)

    // Clearing
    let actualSlide: OutSlide | null = null
    let actualSlideData: SlideData | null = null
    let actualCurrentSlide: Slide | null = null
    let actualCurrentLineId: string | undefined = undefined
    let isSlideClearing = false
    let ratio = 1

    $: if (slide !== undefined || layers) {
        const slideActive = layers.includes("slide")
        isSlideClearing = !slide || !slideActive
        setTimeout(() => {
            actualSlide = slideActive ? clone(slide) : null
            actualSlideData = clone(slideData)
            actualCurrentSlide = clone(currentSlide)
            actualCurrentLineId = clone(currentLineId)
        })
    }

    // --- PixiJS init (dynamic import) ---
    onMount(async () => {
        if (!canvas) return

        try {
            const PIXI = await import("pixi.js")

            // Use output resolution with style aspect ratio applied
            const initRes = getOutputResolution(outputId, $outputs, true)
            const initW = initRes?.width || 1920
            const initH = initRes?.height || 1080

            const app = new PIXI.Application()
            await app.init({
                canvas,
                width: initW,
                height: initH,
                backgroundColor: 0x000000,
                backgroundAlpha: currentOutput?.transparent ? 0 : 1,
                preference: "webgl",
                resolution: 1
            })
            pixiApp = app

            rendererMod = await import("./PixiRenderer")
            layerMgrMod = await import("./LayerManager")

            const containers = rendererMod.createStageContainers(app)
            // publish the slide background's video currentTime/duration/paused so MediaControls, remote, stage display all work for WebGPU outputs.
            // Like BackgroundMedia.svelte, we live in the output window — MediaControls reads the *main window's* videosTime/videosData store.
            // That store is populated by receivers.ts MAIN_TIME/MAIN_DATA handlers, so we must send via IPC (writing to our local store in this window has no effect on the main window UI).
            // Throttle time sends to ~220ms to match BackgroundMedia.
            const videoTimeHandler = ({ currentTime, duration, paused }: { currentTime: number; duration: number; paused: boolean }) => {
                send(OUTPUT, ["MAIN_DATA"], { [outputId]: { duration, paused } })
                if (timeSendingTimeout) return
                send(OUTPUT, ["MAIN_TIME"], { [outputId]: currentTime })
                timeSendingTimeout = setTimeout(() => {
                    timeSendingTimeout = null
                }, 220)
            }
            layerMgr = await layerMgrMod.createLayerManager(app, containers, initW, initH, videoTimeHandler)
            pixiReady = true
        } catch (e) {
            console.error("WebGPUOutput:", e)
        }
    })

    onDestroy(() => {
        if (slideBgClearTimer) clearTimeout(slideBgClearTimer)
        if (styleBgClearTimer) clearTimeout(styleBgClearTimer)
        if (timeSendingTimeout) clearTimeout(timeSendingTimeout)
        if (layerMgr && layerMgrMod) layerMgrMod.destroyLayerManager(layerMgr)
        if (pixiApp) pixiApp.destroy(true, { children: true, texture: true })
    })

    // --- Reactive PixiJS updates ---
    // NOTE: these blocks depend on `mediaTransition` (memoized), NOT `transitions`, so changing
    // text/overlay transitions never retriggers media-update calls.
    //
    // Null dispatches are deferred by CLEAR_DEBOUNCE_MS so transient null states in the reactive
    // chain (e.g. between two slides that both reference the same media) don't destroy the
    // existing video/sprite state and cause a visible "black flash" reload.

    // Style background — update or clear
    $: if (pixiReady && layerMgr && layerMgrMod) {
        if (styleBackground) {
            if (styleBgClearTimer) {
                clearTimeout(styleBgClearTimer)
                styleBgClearTimer = null
            }
            layerMgrMod.updateStyleBackground(layerMgr, styleBackgroundData, mediaTransition)
        } else if (!styleBgClearTimer) {
            styleBgClearTimer = setTimeout(() => {
                styleBgClearTimer = null
                if (layerMgr && layerMgrMod) layerMgrMod.updateStyleBackground(layerMgr, null, {})
            }, CLEAR_DEBOUNCE_MS)
        }
    }

    // Slide background — update or clear
    $: if (pixiReady && layerMgr && layerMgrMod) {
        if (backgroundData && (backgroundData.path || backgroundData.id)) {
            if (slideBgClearTimer) {
                clearTimeout(slideBgClearTimer)
                slideBgClearTimer = null
            }
            layerMgrMod.updateSlideBackground(layerMgr, backgroundData, mediaTransition)
        } else if (!slideBgClearTimer) {
            slideBgClearTimer = setTimeout(() => {
                slideBgClearTimer = null
                if (layerMgr && layerMgrMod) layerMgrMod.updateSlideBackground(layerMgr, null, {})
            }, CLEAR_DEBOUNCE_MS)
        }
    }

    // Resize
    $: if (pixiReady && pixiApp && rendererMod && layerMgr && layerMgrMod && resolution?.width > 0 && resolution?.height > 0) {
        rendererMod.resizeApp(pixiApp, resolution.width, resolution.height)
        layerMgrMod.resizeAllLayers(layerMgr, resolution.width, resolution.height)
    }
</script>

<Zoomed id={outputId} background={backgroundColor} backgroundDuration={mediaBackgroundDuration} center {style} {resolution} bind:ratio>
    <div class="content-wrapper">
        <!-- PixiJS canvas for media/background layers -->
        <canvas bind:this={canvas} class="pixi-canvas" />

        <!-- DOM overlay for text (directly visible, on top of canvas) -->
        <div class="text-overlay">
            {#if overlaysActive}
                <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions?.overlay || {}} mirror={false} preview={false} />
            {/if}

            {#if actualSlide && actualSlide?.type !== "pdf" && actualSlide?.type !== "ppt"}
                <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} animationData={{}} currentLineId={actualCurrentLineId} {lines} {ratio} mirror={false} preview={false} transition={transitions?.text || {}} transitionEnabled={true} styleIdOverride="" />
                <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions?.text || {}} />
            {/if}

            {#if overlaysActive}
                <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions?.overlay || {}} mirror={false} preview={false} />
            {/if}
        </div>
    </div>
</Zoomed>

<style>
    .content-wrapper {
        position: relative;
        overflow: hidden;
        width: 100%;
        height: 100%;
    }
    .pixi-canvas {
        display: block;
        width: 100%;
        height: 100%;
    }
    .text-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: none;
    }
    .text-overlay :global(.item) {
        position: absolute;
        font-family: "CMGSans";
        text-shadow: 2px 2px 10px #000000;
        color: white;
        font-size: 100px;
        line-height: 1.1;
        -webkit-text-stroke-color: #000000;
        paint-order: stroke fill;
    }
</style>
