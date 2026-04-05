<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte"
    import type { OutData } from "../../../../types/Output"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, OutSlide, Slide, SlideData, Transition } from "../../../../types/Show"
    import { allOutputs, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../../stores"
    import { clone } from "../../helpers/array"
    import { defaultLayers, getCurrentStyle, getMetadata, getOutputLines, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../../helpers/output"
    import { _show } from "../../helpers/shows"
    import Zoomed from "../../slide/Zoomed.svelte"
    import SlideContent from "../layers/SlideContent.svelte"
    import Overlay from "../layers/Overlay.svelte"
    import Overlays from "../layers/Overlays.svelte"
    import Draw from "../../draw/Draw.svelte"
    import { initPixiApp, createStageContainers, resizeApp, destroyApp, createDefaultConfig } from "./PixiRenderer"
    import { createLayerManager, updateStyleBackground, updateSlideBackground, updateSlideText, resizeAllLayers, destroyLayerManager, type LayerManagerState } from "./LayerManager"

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
    $: alignPosition = currentStyle?.aspectRatio?.alignPosition || "center"

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
    $: outOverlays = out.overlays?.filter((id) => !clonedOverlays?.[id]?.placeUnderSlide) || []
    $: outUnderlays = out.overlays?.filter((id) => clonedOverlays?.[id]?.placeUnderSlide) || []

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
    $: effectsUnderSlide = effectsIds.filter((id) => allEffects[id]?.placeUnderSlide === true)
    $: effectsOverSlide = effectsIds.filter((id) => !allEffects[id]?.placeUnderSlide)

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

    // --- PixiJS Integration ---
    let canvas: HTMLCanvasElement
    let layerManager: LayerManagerState | null = null
    let pixiReady = false
    let initError = ""

    // Hidden off-screen container for text rasterization
    let offscreenSlide: HTMLDivElement
    let offscreenOverlays: HTMLDivElement

    onMount(async () => {
        if (!canvas) {
            console.error("WebGPUOutput: canvas element not bound")
            initError = "Canvas not available"
            return
        }

        try {
            const w = resolution.width || 1920
            const h = resolution.height || 1080
            console.log("WebGPUOutput: initializing PixiJS", w, "x", h)

            const config = createDefaultConfig(w, h, !!currentOutput.transparent)
            const app = await initPixiApp(canvas, config)
            const containers = createStageContainers(app)
            layerManager = createLayerManager(app, containers, config.width, config.height)
            pixiReady = true

            console.log("WebGPUOutput: PixiJS ready, canvas size:", canvas.width, "x", canvas.height)
        } catch (e) {
            console.error("WebGPUOutput: PixiJS init failed:", e)
            initError = String(e)
        }
    })

    onDestroy(() => {
        if (layerManager) {
            destroyLayerManager(layerManager)
            destroyApp(layerManager.app)
        }
    })

    // --- Reactive updates to PixiJS layers ---

    // Style background
    $: if (pixiReady && layerManager && styleBackground && actualSlide?.type !== "pdf") {
        console.log("WebGPUOutput: updating style background:", styleBackgroundData?.path)
        updateStyleBackground(layerManager, styleBackgroundData, transitions.media || {})
    }

    // Slide background
    $: if (pixiReady && layerManager && backgroundData) {
        console.log("WebGPUOutput: updating slide background:", backgroundData?.path || backgroundData?.id)
        updateSlideBackground(layerManager, backgroundData, transitions.media || {})
    }

    // Slide text — rasterize from hidden DOM and upload to GPU
    $: slideKey = actualSlide ? JSON.stringify({ id: actualSlide.id, index: actualSlide.index, line: actualSlide.line }) : ""
    $: if (pixiReady && layerManager && offscreenSlide && (slideKey || isSlideClearing)) {
        // Wait for Svelte to render the text in the hidden container, then rasterize
        tick().then(() => {
            setTimeout(() => {
                if (!layerManager) return
                console.log("WebGPUOutput: rasterizing slide text, key:", slideKey, "clearing:", isSlideClearing)
                updateSlideText(
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
    $: if (pixiReady && layerManager && resolution) {
        const w = resolution.width || 1920
        const h = resolution.height || 1080
        resizeApp(layerManager.app, w, h)
        resizeAllLayers(layerManager, w, h)
    }
</script>

<Zoomed id={outputId} background={backgroundColor} checkered={(preview || mirror) && backgroundColor === "transparent"} backgroundDuration={transitions.media?.type === "none" ? 0 : (transitions.media?.duration ?? 800)} align={alignPosition} center {style} {resolution} {mirror} {drawZoom} {cropping} bind:ratio>
    <!-- PixiJS canvas — renders ALL layers (backgrounds, text, overlays, effects) -->
    <div class="pixi-wrapper">
        <canvas bind:this={canvas} />
    </div>

    {#if initError}
        <div class="init-error">PixiJS Error: {initError}</div>
    {/if}

    <!-- Draw tool stays as DOM overlay (uses Canvas 2D, migrated separately) -->
    {#if zoomActive}
        <Draw />
    {/if}
</Zoomed>

<!-- Hidden off-screen container for text rasterization -->
<!-- Svelte renders the text here using existing components, then we capture it as an image for PixiJS -->
<div class="offscreen-renderer" aria-hidden="true">
    <div bind:this={offscreenSlide} class="offscreen-slide" style="width: {resolution.width || 1920}px; height: {resolution.height || 1080}px; position: relative; overflow: hidden;">
        <!-- Underlays -->
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}

        <!-- Slide content -->
        {#if actualSlide && actualSlide?.type !== "pdf" && actualSlide?.type !== "ppt"}
            <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} animationData={{}} currentLineId={actualCurrentLineId} {lines} {ratio} {mirror} {preview} transition={transitions.text} transitionEnabled={false} {styleIdOverride} />

            <!-- Metadata -->
            <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions.text} />
        {/if}

        <!-- Overlays -->
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}
    </div>
</div>

<style>
    /* PixiJS manages canvas pixel dimensions internally via resolution.
       The wrapper stretches to fill the Zoomed container so the canvas covers the output area. */
    .pixi-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
    }

    .pixi-wrapper canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .init-error {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: red;
        font-size: 24px;
        z-index: 999;
    }

    /* Off-screen renderer: positioned far off-screen, invisible, but fully painted by the browser.
       This lets Svelte render text with all CSS (fonts, shadows, stroke) so we can rasterize it. */
    .offscreen-renderer {
        position: fixed;
        top: -20000px;
        left: -20000px;
        pointer-events: none;
        visibility: visible; /* must be visible for html-to-image to capture */
        opacity: 1;
        z-index: -9999;
    }

    .offscreen-slide {
        background: transparent;
    }

    /* Inherit the output window's default item styles so text renders correctly off-screen */
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
