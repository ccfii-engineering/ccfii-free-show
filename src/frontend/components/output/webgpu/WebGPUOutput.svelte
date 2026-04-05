<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte"
    import type { OutData } from "../../../../types/Output"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, OutSlide, Slide, SlideData, Transition } from "../../../../types/Show"
    import { allOutputs, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../../stores"
    import { clone } from "../../helpers/array"
    import { defaultLayers, getCurrentStyle, getMetadata, getOutputLines, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../../helpers/output"
    import { _show } from "../../helpers/shows"
    import SlideContent from "../layers/SlideContent.svelte"
    import Overlay from "../layers/Overlay.svelte"
    import Overlays from "../layers/Overlays.svelte"
    import Draw from "../../draw/Draw.svelte"

    // PixiJS and layer managers loaded dynamically to avoid static import issues
    let pixiModule: any = null
    let rendererModule: any = null
    let layerManagerModule: any = null

    export let outputId = ""
    export let style = ""
    export let ratio = 0
    export let mirror = false
    export let preview = false
    export let styleIdOverride = ""
    export let outOverride: OutData | null = null

    // --- Store reads (identical to Output.svelte) ---
    $: currentOutput = $outputs[outputId] || $allOutputs[outputId] || {}
    $: currentStyling = getCurrentStyle($styles, styleIdOverride || currentOutput.style)
    let currentStyle: Styles = { name: "" }
    $: if (JSON.stringify(currentStyling) !== JSON.stringify(currentStyle)) currentStyle = clone(currentStyling)

    let layers: string[] = []
    let out: OutData = {}
    let slide: OutSlide | null = null
    let background: OutBackground | null = null
    let clonedOverlays: any = null

    $: if (currentOutput && JSON.stringify(layers) !== JSON.stringify(currentStyle.layers || defaultLayers)) {
        layers = clone(Array.isArray(currentStyle.layers) ? currentStyle.layers : defaultLayers)
        if (!Array.isArray(layers)) layers = []
    }
    $: if (JSON.stringify(out) !== JSON.stringify(outOverride || currentOutput?.out || {})) out = clone(outOverride || currentOutput?.out || {})
    $: if (JSON.stringify(slide) !== JSON.stringify(out.slide || null)) slide = clone(out.slide || null)
    $: if (JSON.stringify(background) !== JSON.stringify(out.background || null)) background = clone(out.background || null)

    // Overlays
    $: overlayIds = out.overlays
    let storedOverlayIds = ""
    let storedOverlays = ""
    $: if (JSON.stringify(overlayIds) !== storedOverlayIds) {
        storedOverlayIds = JSON.stringify(out.overlays)
        if (JSON.stringify($overlays) !== storedOverlays) {
            clonedOverlays = clone($overlays)
            storedOverlays = JSON.stringify($overlays)
        }
    }
    $: outOverlays = out.overlays?.filter((id: string) => !clonedOverlays?.[id]?.placeUnderSlide) || []
    $: outUnderlays = out.overlays?.filter((id: string) => clonedOverlays?.[id]?.placeUnderSlide) || []

    // Layout & slide data
    let currentLayout: any[] = []
    let slideData: SlideData | null = null
    let currentSlide: Slide | null = null

    $: updateSlideData(slide, outputId)
    function updateSlideData(slide: any, _outputChanged: string) {
        if (!slide) { currentLayout = []; slideData = null; currentSlide = null; return }
        currentLayout = clone(_show(slide.id).layouts([slide.layout]).ref()[0] || [])
        slideData = currentLayout[slide?.index]?.data || null
        let newCurrentSlide = getCurrentSlide()
        if (JSON.stringify(newCurrentSlide) !== JSON.stringify(currentSlide)) currentSlide = newCurrentSlide
        function getCurrentSlide() {
            if (!slide && !outputId) return null
            if (slide.id === "temp" || slide.id === "tempText") return { items: slide.tempItems }
            if (!currentLayout) return null
            let slideId: string = currentLayout[slide?.index]?.id || ""
            return clone(_show(slide.id).slides([slideId]).get()[0] || {})
        }
    }

    // Transitions & filters
    $: resolution = getResolution(null, { currentOutput, currentStyle }, false, outputId, styleIdOverride)
    $: transitions = getOutputTransitions(slideData, currentStyle.transition, $transitionData, mirror && !preview)
    $: slideFilter = getSlideFilter(slideData)

    // Template handling
    $: outputStyle = styleIdOverride || currentOutput?.style
    $: if (outputStyle && currentStyle && currentSlide !== undefined) {
        if (currentSlide) currentSlide.items = setTemplateStyle(slide!, currentStyle, currentSlide.items, outputId, currentSlide.customDynamicValues)
        styleTemplate = getStyleTemplate(slide!, currentStyle)
    }
    let styleTemplate: any = null
    $: templateBackground = styleTemplate?.settings?.backgroundPath || ""

    // Lines
    let lines: any = {}
    $: currentLineId = slide?.id
    const updateLinesTime = $currentWindow === "output" ? 50 : 10
    $: if (currentLineId) setTimeout(() => { lines[currentLineId] = getOutputLines(slide!, currentStyle.lines) }, updateLinesTime)

    // Metadata
    $: metadataItems = getMetadata($showsCache[(slide as any)?.id || ""], currentStyle, slide, $templates)
    let currentMetadataItems: any[] = []
    let isMetadataClearing = false
    $: if (metadataItems !== null) { isMetadataClearing = false; if (JSON.stringify(metadataItems) !== JSON.stringify(currentMetadataItems)) currentMetadataItems = clone(metadataItems) }
    else { isMetadataClearing = true; setTimeout(() => { currentMetadataItems = [] }) }

    // Effects
    $: effectsIds = clone(out.effects || [])
    $: allEffects = $effects
    $: effectsUnderSlide = effectsIds.filter((id: string) => allEffects[id]?.placeUnderSlide === true)
    $: effectsOverSlide = effectsIds.filter((id: string) => !allEffects[id]?.placeUnderSlide)

    $: overlaysActive = !!(layers.includes("overlays") && clonedOverlays)
    $: cropping = currentOutput.cropping || currentStyle.cropping

    // Background data
    $: backgroundColor = currentOutput.transparent ? "transparent" : styleTemplate?.settings?.backgroundColor || currentSlide?.settings?.color || currentStyle.background || slide?.settings?.backgroundColor || "black"
    $: styleBackground = currentStyle?.clearStyleBackgroundOnText && (slide || background) ? "" : currentStyle?.backgroundImage || ""
    $: styleBackgroundData = { path: styleBackground, ...($media[styleBackground] || {}), loop: true }
    $: templateBackgroundData = { path: templateBackground, loop: true, ...($media[templateBackground] || {}) }
    $: backgroundData = templateBackground ? templateBackgroundData : background

    // Draw zoom
    $: zoomActive = currentOutput.active || (mirror && !preview)
    $: drawZoom = $drawTool === "zoom" && zoomActive ? ($drawSettings.zoom?.size || 200) / 100 : 1

    // Clearing logic
    $: if (slide !== undefined || layers) updateSlide()
    let actualSlide: OutSlide | null = null
    let actualSlideData: SlideData | null = null
    let actualCurrentSlide: Slide | null = null
    let actualCurrentLineId: string | undefined = undefined
    let isSlideClearing = false
    function updateSlide() {
        const slideActive = layers.includes("slide")
        isSlideClearing = !slide || !slideActive
        setTimeout(() => {
            actualSlide = slideActive ? clone(slide) : null
            actualSlideData = clone(slideData)
            actualCurrentSlide = clone(currentSlide)
            actualCurrentLineId = clone(currentLineId)
        })
    }

    // --- PixiJS Integration (dynamic imports) ---
    let canvas: HTMLCanvasElement
    let pixiApp: any = null
    let layerManager: any = null
    let pixiReady = false
    let status = "Initializing..."

    // Hidden off-screen container for text rasterization
    let offscreenSlide: HTMLDivElement

    onMount(async () => {
        if (!canvas) {
            status = "ERROR: no canvas element"
            return
        }

        try {
            status = "Loading PixiJS..."
            const PIXI = await import("pixi.js")

            status = "Creating app..."
            const app = new PIXI.Application()
            await app.init({
                canvas,
                width: 1920,
                height: 1080,
                backgroundColor: 0x000000,
                backgroundAlpha: currentOutput.transparent ? 0 : 1,
                preference: "webgl",
                antialias: true,
                resolution: 1
            })
            pixiApp = app

            status = "Setting up layers..."
            rendererModule = await import("./PixiRenderer")
            layerManagerModule = await import("./LayerManager")

            const containers = rendererModule.createStageContainers(app)
            layerManager = layerManagerModule.createLayerManager(app, containers, 1920, 1080)
            pixiReady = true

            status = `Ready (${app.renderer.type === 0x02 ? "WebGPU" : "WebGL"})`
            console.log("WebGPUOutput:", status)
        } catch (e) {
            status = "FAILED: " + String(e)
            console.error("WebGPUOutput init error:", e)
        }
    })

    onDestroy(() => {
        if (layerManager && layerManagerModule) {
            layerManagerModule.destroyLayerManager(layerManager)
        }
        if (pixiApp) {
            pixiApp.destroy(true, { children: true, texture: true })
        }
    })

    // --- Reactive updates to PixiJS layers ---

    $: if (pixiReady && layerManager && layerManagerModule && styleBackground && actualSlide?.type !== "pdf") {
        layerManagerModule.updateStyleBackground(layerManager, styleBackgroundData, transitions.media || {})
    }

    $: if (pixiReady && layerManager && layerManagerModule && backgroundData) {
        layerManagerModule.updateSlideBackground(layerManager, backgroundData, transitions.media || {})
    }

    // Slide text rasterization
    $: slideKey = actualSlide ? JSON.stringify({ id: actualSlide.id, index: actualSlide.index, line: actualSlide.line }) : ""
    $: if (pixiReady && layerManager && layerManagerModule && offscreenSlide && (slideKey || isSlideClearing)) {
        tick().then(() => {
            setTimeout(() => {
                if (!layerManager || !layerManagerModule) return
                layerManagerModule.updateSlideText(
                    layerManager,
                    (actualSlide && !isSlideClearing) ? offscreenSlide : null,
                    slideKey,
                    transitions.text || {},
                    isSlideClearing
                )
            }, 100)
        })
    }

    // Resize
    $: if (pixiReady && pixiApp && layerManager && rendererModule && layerManagerModule && resolution) {
        const w = resolution.width || 1920
        const h = resolution.height || 1080
        if (w > 0 && h > 0) {
            rendererModule.resizeApp(pixiApp, w, h)
            layerManagerModule.resizeAllLayers(layerManager, w, h)
        }
    }
</script>

<!-- Full-screen output -->
<div class="output-root" style="background: {backgroundColor};">
    <canvas bind:this={canvas} class="pixi-canvas" />

    <p class="status-text">{status}</p>

    {#if zoomActive}
        <Draw />
    {/if}
</div>

<!-- Hidden off-screen container for text rasterization -->
<div class="offscreen-renderer" aria-hidden="true">
    <div bind:this={offscreenSlide} class="offscreen-slide" style="width: {resolution.width || 1920}px; height: {resolution.height || 1080}px; position: relative; overflow: hidden;">
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}

        {#if actualSlide && actualSlide?.type !== "pdf" && actualSlide?.type !== "ppt"}
            <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} animationData={{}} currentLineId={actualCurrentLineId} {lines} {ratio} {mirror} {preview} transition={transitions.text} transitionEnabled={false} {styleIdOverride} />
            <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions.text} />
        {/if}

        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}
    </div>
</div>

<style>
    .output-root {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .pixi-canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .status-text {
        position: absolute;
        top: 10px;
        left: 10px;
        color: #0f0;
        font-family: monospace;
        font-size: 16px;
        z-index: 999;
        pointer-events: none;
    }

    .offscreen-renderer {
        position: fixed;
        top: -20000px;
        left: -20000px;
        pointer-events: none;
        visibility: visible;
        opacity: 1;
        z-index: -9999;
    }

    .offscreen-slide {
        background: transparent;
    }

    .offscreen-slide :global(.item) {
        position: absolute;
        font-family: "CMGSans";
        text-shadow: 2px 2px 10px #000000;
        color: white;
        font-size: 100px;
        line-height: 1.1;
        -webkit-text-stroke-color: #000000;
        paint-order: stroke fill;
        border-style: solid;
        border-width: 0px;
        border-color: #ffffff;
    }
</style>
