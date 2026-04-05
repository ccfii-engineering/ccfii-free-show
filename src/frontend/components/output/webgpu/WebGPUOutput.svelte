<script lang="ts">
    import { onDestroy, onMount } from "svelte"
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
    import { createLayerManager, updateStyleBackground, updateSlideBackground, resizeAllLayers, destroyLayerManager, type LayerManagerState } from "./LayerManager"

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

    onMount(async () => {
        const config = createDefaultConfig(resolution.width || 1920, resolution.height || 1080, !!currentOutput.transparent)
        const app = await initPixiApp(canvas, config)
        const containers = createStageContainers(app)
        layerManager = createLayerManager(app, containers, config.width, config.height)
        pixiReady = true
    })

    onDestroy(() => {
        if (layerManager) {
            destroyLayerManager(layerManager)
            destroyApp(layerManager.app)
        }
    })

    // --- Reactive updates to PixiJS layers ---
    $: if (pixiReady && layerManager && styleBackground && actualSlide?.type !== "pdf") {
        updateStyleBackground(layerManager, styleBackgroundData, transitions.media || {})
    }

    $: if (pixiReady && layerManager && backgroundData) {
        updateSlideBackground(layerManager, backgroundData, transitions.media || {})
    }

    $: if (pixiReady && layerManager && resolution) {
        resizeApp(layerManager.app, resolution.width || 1920, resolution.height || 1080)
        resizeAllLayers(layerManager, resolution.width || 1920, resolution.height || 1080)
    }
</script>

<Zoomed id={outputId} background={backgroundColor} checkered={(preview || mirror) && backgroundColor === "transparent"} backgroundDuration={transitions.media?.type === "none" ? 0 : (transitions.media?.duration ?? 800)} align={alignPosition} center {style} {resolution} {mirror} {drawZoom} {cropping} bind:ratio>
    <!-- PixiJS canvas for media layers (backgrounds, effects) -->
    <canvas bind:this={canvas} class="pixi-canvas" />

    <!-- DOM overlay for text content (slide, overlays) -->
    <div class="dom-overlay">
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}

        {#if actualSlide && actualSlide?.type !== "pdf" && actualSlide?.type !== "ppt"}
            <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} animationData={{}} currentLineId={actualCurrentLineId} {lines} {ratio} {mirror} {preview} transition={transitions.text} transitionEnabled={!mirror || preview} {styleIdOverride} />

            <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions.text} />
        {/if}

        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}
    </div>

    {#if zoomActive}
        <Draw />
    {/if}
</Zoomed>

<style>
    .pixi-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
    }

    .dom-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: none;
    }
</style>
