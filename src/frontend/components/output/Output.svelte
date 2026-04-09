<!-- Used in output window, and currently in draw! -->
<svelte:options immutable={true} />

<script lang="ts">
    import { onDestroy } from "svelte"
    import { uid } from "uid"
    import type { OutData } from "../../../types/Output"
    import type { Styles } from "../../../types/Settings"
    import type { AnimationData, Item, LayoutRef, OutBackground, OutSlide, Slide, SlideData, Template, Overlays as TOverlays } from "../../../types/Show"
    import { allOutputs, colorbars, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../stores"
    import { outputEntry, styleEntry } from "../../utils/perEntryStores"
    import { getCurrentLineMap, getIdArraySignature, getJsonSignature, getSelectedEntriesSignature } from "../../utils/outputSignatures"
    import { wait } from "../../utils/common"
    import { customTick } from "../../utils/transitions"
    import Draw from "../draw/Draw.svelte"
    import { clone } from "../helpers/array"
    import { defaultLayers, getCurrentStyle, getMetadata, getOutputLines, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../helpers/output"
    import { _show } from "../helpers/shows"
    import Image from "../media/Image.svelte"
    import Zoomed from "../slide/Zoomed.svelte"
    import { updateAnimation } from "./animation"
    import EffectOutput from "./effects/EffectOutput.svelte"
    import Background from "./layers/Background.svelte"
    import Overlay from "./layers/Overlay.svelte"
    import Overlays from "./layers/Overlays.svelte"
    import PdfOutput from "./layers/PdfOutput.svelte"
    import SlideContent from "./layers/SlideContent.svelte"
    import Window from "./Window.svelte"

    export let outputId = ""
    export let style = ""
    export let ratio = 0
    export let mirror = false
    export let preview = false
    export let styleIdOverride = ""
    export let outOverride: OutData | null = null

    $: myOutput = outputEntry(outputId)
    $: currentOutput = $myOutput || $outputs[outputId] || $allOutputs[outputId] || {}

    // --- Cached JSON change detection ---------------------------------------------------------
    // Instead of stringifying BOTH sides on every reactive tick (as the original code did), we
    // cache the previous JSON string for the "current" side and only stringify the incoming side.
    // Roughly 50% cheaper than the original, and — unlike hand-crafted signature functions —
    // correctly detects ALL content changes including fields we don't specifically know about.
    // This matters because the settings history system mutates store entries in place (see
    // historyActions.ts:242), so reference equality doesn't work.

    // output styling
    $: myStyle = styleEntry(styleIdOverride || currentOutput.style || "")
    $: currentStyling = $myStyle || getCurrentStyle($styles, styleIdOverride || currentOutput.style)
    let currentStyle: Styles = { name: "" }
    let lastCurrentStyleJson = ""
    $: {
        const json = JSON.stringify(currentStyling)
        if (json !== lastCurrentStyleJson) {
            lastCurrentStyleJson = json
            currentStyle = clone(currentStyling)
        }
    }

    $: alignPosition = currentStyle?.aspectRatio?.alignPosition || "center"

    // layers
    let layers: string[] = []
    let out: OutData = {}
    let slide: OutSlide | null = null
    let background: OutBackground | null = null
    let clonedOverlays: TOverlays | null = null

    // No clone needed — effectsIds is only read via .filter() below, never mutated
    $: effectsIds = out.effects || []
    $: allEffects = $effects
    $: effectsUnderSlide = effectsIds.filter((id) => allEffects[id]?.placeUnderSlide === true)
    $: effectsOverSlide = effectsIds.filter((id) => !allEffects[id]?.placeUnderSlide)

    // don't update when layer content changes, only when refreshing or adding/removing layer
    // currentOutput is set to refresh state when changed in preview
    let lastLayersJson = ""
    $: if (currentOutput) {
        const target = getIdArraySignature(currentStyle.layers || defaultLayers)
        if (target !== lastLayersJson) {
            lastLayersJson = target
            if (getIdArraySignature(layers) !== target) setNewLayers()
        }
    }
    function setNewLayers() {
        layers = clone(Array.isArray(currentStyle.layers) ? currentStyle.layers : defaultLayers)
        if (!Array.isArray(layers)) layers = []
    }

    let lastOutJson = ""
    $: {
        const targetOut = outOverride || currentOutput?.out || {}
        const json = [getJsonSignature(targetOut.slide || null), getJsonSignature(targetOut.background || null), getIdArraySignature(targetOut.overlays), getIdArraySignature(targetOut.effects), targetOut.refresh ? "1" : "0"].join("|")
        if (json !== lastOutJson) {
            lastOutJson = json
            out = clone(targetOut)
        }
    }

    let lastSlideJson = ""
    $: {
        const json = getJsonSignature(out.slide || null)
        if (json !== lastSlideJson) {
            lastSlideJson = json
            updateOutData("slide")
        }
    }
    let lastBgJson = ""
    $: {
        const json = getJsonSignature(out.background || null)
        if (json !== lastBgJson) {
            lastBgJson = json
            updateOutData("background")
        }
    }

    $: refreshOutput = out.refresh
    let lineUpdateTimeout: NodeJS.Timeout | null = null
    let metadataClearTimeout: NodeJS.Timeout | null = null
    $: if (outputId || refreshOutput) updateOutData()
    function updateOutData(type = "") {
        if (!type || type === "slide") {
            // don't refresh if changing lines on another slide & content is unchanged
            let noLineCurrent = clone(slide)
            if (noLineCurrent) delete noLineCurrent.line
            let noLineNew = clone(out?.slide)
            if (noLineNew) delete noLineNew.line
            if (!refreshOutput && !out?.slide?.type && lines[currentLineId || ""]?.start === null && getJsonSignature(noLineCurrent) === getJsonSignature(noLineNew)) return

            slide = clone(out.slide || null)
        }
        if (!type || type === "background") background = clone(out.background || null)
        if (!type || type === "overlays") {
            storedOverlayIds = getIdArraySignature(out.overlays)
            if (getSelectedEntriesSignature($overlays, out.overlays || []) !== storedOverlays) {
                clonedOverlays = clone($overlays)
                storedOverlays = getSelectedEntriesSignature($overlays, out.overlays || [])
            }
        }
    }

    // overlays
    $: overlayIds = out.overlays
    let storedOverlayIds = ""
    let storedOverlays = ""
    $: if (getIdArraySignature(overlayIds) !== storedOverlayIds) updateOutData("overlays")
    $: outOverlays = out.overlays?.filter((id) => !clonedOverlays?.[id]?.placeUnderSlide) || []
    $: outUnderlays = out.overlays?.filter((id) => clonedOverlays?.[id]?.placeUnderSlide) || []

    // layout & slide data
    let currentLayout: LayoutRef[] = []
    let slideData: SlideData | null = null
    let currentSlide: Slide | null = null

    $: updateSlideData(slide, outputId)
    function updateSlideData(slide: OutSlide | null, _outputChanged: string) {
        if (!slide) {
            currentLayout = []
            slideData = null
            currentSlide = null
            return
        }

        const currentOutSlide = slide
        currentLayout = clone(_show(currentOutSlide.id).layouts([currentOutSlide.layout]).ref()[0] || [])
        slideData = currentLayout[currentOutSlide.index || 0]?.data || null

        // don't refresh content unless it changes
        let newCurrentSlide = getCurrentSlide()
        if (getJsonSignature(formatSlide(newCurrentSlide)) !== getJsonSignature(currentSlide)) currentSlide = newCurrentSlide

        function getCurrentSlide() {
            if (!currentOutSlide && !outputId) return null
            if (currentOutSlide.id === "temp" || currentOutSlide.id === "tempText") return { items: currentOutSlide.tempItems }
            if (!currentLayout) return null

            let slideId: string = currentLayout[currentOutSlide.index || 0]?.id || ""
            return clone(_show(currentOutSlide.id).slides([slideId]).get()[0] || {})
        }

        // add template item keys to not update item when no changes is made (when custom style template is set)
        function formatSlide(currentSlide: Slide | null) {
            if (!currentSlide) return null
            let newSlide = clone(currentSlide)
            newSlide.items = setTemplateStyle(slide, currentStyle, newSlide.items, outputId, newSlide.customDynamicValues)
            return newSlide
        }
    }

    // slide styling
    // currentSlide?.settings?.resolution
    $: resolution = getResolution(null, { currentOutput, currentStyle }, false, outputId, styleIdOverride)
    $: transitions = getOutputTransitions(slideData, currentStyle.transition, $transitionData, mirror && !preview)
    $: slideFilter = getSlideFilter(slideData)

    // custom template
    // WIP revert to old style when output style is reverted to no style (REFRESH OUTPUT)
    $: outputStyle = styleIdOverride || currentOutput?.style
    // currentSlide is so the background updates when scripture is removed (if template background on both) - not changed in preview
    $: if (outputStyle && currentStyle && currentSlide !== undefined) {
        if (currentSlide) setTemplateItems()
        getStyleTemplateData()
    }
    const setTemplateItems = () => (currentSlide!.items = setTemplateStyle(slide!, currentStyle, currentSlide!.items, outputId, currentSlide!.customDynamicValues))
    let styleTemplate: Template | null = null
    const getStyleTemplateData = () => (styleTemplate = getStyleTemplate(slide!, currentStyle))
    $: templateBackground = styleTemplate?.settings?.backgroundPath || ""

    // lines
    let lines: { [key: string]: { start: number | null; end: number | null; linesStart?: number | null; linesEnd?: number | null; clickRevealed?: boolean } } = {}
    $: currentLineId = slide?.id
    const updateLinesTime = $currentWindow === "output" ? 50 : 10
    $: if (currentLineId) {
        // don't update until all outputs has updated their "line" value
        if (lineUpdateTimeout) clearTimeout(lineUpdateTimeout)
        lineUpdateTimeout = setTimeout(() => {
            const lineId = currentLineId
            if (!lineId) return
            lines = { ...lines, ...getCurrentLineMap({ [lineId]: getOutputLines(slide!, currentStyle.lines) }, lineId) }
        }, updateLinesTime)
    }

    // metadata
    $: metadataItems = getMetadata($showsCache[(slide as any)?.id || ""], currentStyle, slide, $templates)
    let currentMetadataItems: Item[] = []
    let isMetadataClearing = false
    $: if (metadataItems !== null) {
        isMetadataClearing = false
        if (metadataClearTimeout) {
            clearTimeout(metadataClearTimeout)
            metadataClearTimeout = null
        }
        if (getJsonSignature(metadataItems) !== getJsonSignature(currentMetadataItems)) currentMetadataItems = clone(metadataItems)
    } else {
        isMetadataClearing = true
        if (metadataClearTimeout) clearTimeout(metadataClearTimeout)
        metadataClearTimeout = setTimeout(() => {
            currentMetadataItems = []
            metadataClearTimeout = null
        })
    }

    // ANIMATE
    let animationData: AnimationData = {}
    let currentAnimationId = ""
    $: slideAnimation = slideData?.actions?.animate || null

    $: if (slide) stopAnimation()
    onDestroy(() => {
        stopAnimation()
        if (lineUpdateTimeout) clearTimeout(lineUpdateTimeout)
        if (metadataClearTimeout) clearTimeout(metadataClearTimeout)
    })
    function stopAnimation() {
        animationData = {}
        currentAnimationId = ""
    }

    // TODO: play slide animations on each textbox so animation can continue while transitioning
    $: if (slideAnimation) initializeAnimation()
    async function initializeAnimation() {
        if (!Object.keys(slideAnimation || {}).length) {
            stopAnimation()
            return
        }

        let duration = 50
        if (transitions.text?.type !== "none" && transitions.text?.duration) duration = Math.max(duration, transitions.text.duration / 2)

        let currentId = uid()
        let animation = clone(slideAnimation) || { actions: [] }
        animationData = { id: currentId, animation }

        await wait(duration)

        if (animationData.id !== currentId) return
        currentAnimationId = currentId

        startAnimation(currentId)
    }

    function startAnimation(currentId: string) {
        animate(0)

        async function animate(currentIndex: number) {
            if (currentAnimationId !== currentId) return

            animationData = await updateAnimation(animationData, currentIndex, slide, background)
            if (currentAnimationId !== currentId) {
                animationData = {}
                return
            }

            if (typeof animationData.newIndex !== "number") return

            // stop if ended & not repeating
            if (!animationData.animation?.repeat && !animationData.animation?.actions[animationData.newIndex]) return

            animate(animationData.newIndex)
        }
    }

    $: cropping = currentOutput.cropping || currentStyle.cropping

    // values
    $: backgroundColor = currentOutput.transparent ? "transparent" : styleTemplate?.settings?.backgroundColor || currentSlide?.settings?.color || currentStyle.background || slide?.settings?.backgroundColor || "black"
    // background image
    $: styleBackground = currentStyle?.clearStyleBackgroundOnText && (slide || background) ? "" : currentStyle?.backgroundImage || ""
    $: styleBackgroundData = { path: styleBackground, ...($media[styleBackground] || {}), loop: true }
    $: templateBackgroundData = { path: templateBackground, loop: true, ...($media[templateBackground] || {}) }
    $: backgroundData = templateBackground ? templateBackgroundData : background

    $: overlaysActive = !!(layers.includes("overlays") && clonedOverlays)

    // draw zoom
    $: zoomActive = currentOutput.active || (mirror && !preview)
    $: drawZoom = $drawTool === "zoom" && zoomActive ? ($drawSettings.zoom?.size || 200) / 100 : 1

    // CLEARING
    $: if (slide !== undefined || layers) updateSlide()
    let actualSlide: OutSlide | null = null
    let actualSlideData: SlideData | null = null
    let actualCurrentSlide: Slide | null = null
    let actualCurrentLineId: string | undefined = undefined
    let isSlideClearing = false
    function updateSlide() {
        // update clearing variable before setting slide value (used for conditions to not show up again while clearing)
        const slideActive = layers.includes("slide")
        isSlideClearing = !slide || !slideActive

        setTimeout(() => {
            actualSlide = slideActive ? clone(slide) : null
            actualSlideData = clone(slideData)
            actualCurrentSlide = clone(currentSlide)
            actualCurrentLineId = clone(currentLineId)
        })
    }
</script>

<Zoomed id={outputId} background={backgroundColor} checkered={(preview || mirror) && backgroundColor === "transparent"} backgroundDuration={transitions.media?.type === "none" ? 0 : (transitions.media?.duration ?? 800)} align={alignPosition} center {style} {resolution} {mirror} {drawZoom} {cropping} bind:ratio>
    <!-- forward the named background slot through to Zoomed for WebGPUOutput's Pixi canvas injection -->
    <svelte:fragment slot="background"><slot name="background" /></svelte:fragment>
    <!-- always show style background (behind other backgrounds) -->
    {#if styleBackground && actualSlide?.type !== "pdf"}
        <Background data={styleBackgroundData} {outputId} transition={transitions.media} {currentStyle} {slideFilter} {ratio} animationStyle={animationData.style?.background || ""} mirror styleBackground />
    {/if}

    <!-- background -->
    {#if (backgroundData?.ignoreLayer ? layers.includes("slide") : layers.includes("background")) && backgroundData}
        <Background data={backgroundData} {outputId} transition={transitions.media} {currentStyle} {slideFilter} {ratio} animationStyle={animationData.style?.background || ""} {mirror} />
    {/if}

    <!-- colorbars for testing -->
    {#if $colorbars[outputId]}
        <Image path="./assets/{$colorbars[outputId]}" mediaStyle={{ rendering: "pixelated", fit: "fill" }} />
    {/if}

    <!-- effects -->
    {#if effectsUnderSlide}
        <EffectOutput ids={effectsUnderSlide} transition={transitions.overlay} {mirror} />
    {/if}

    <!-- "underlays" -->
    {#if overlaysActive}
        <!-- && outUnderlays?.length -->
        <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions.overlay} {mirror} {preview} />
    {/if}

    <!-- slide -->
    {#if actualSlide?.type === "pdf" && layers.includes("background")}
        <span style="zoom: {1 / ratio};">
            <PdfOutput slide={actualSlide} {currentStyle} transition={transitions.media} />
        </span>
    {:else if actualSlide?.type === "ppt" && layers.includes("slide")}
        <span style="zoom: {1 / ratio};">
            {#if actualSlide?.screen?.id}
                <Window id={actualSlide?.screen?.id} class="media" style="width: 100%;height: 100%;" />
            {/if}
        </span>
    {:else if actualSlide && actualSlide?.type !== "pdf"}
        <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} {animationData} currentLineId={actualCurrentLineId} {lines} {ratio} {mirror} {preview} transition={transitions.text} transitionEnabled={!mirror || preview} {styleIdOverride} />

        <!-- metadata -->
        <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions.text} />
    {/if}

    {#if layers.includes("overlays")}
        <!-- effects -->
        {#if effectsOverSlide}
            <EffectOutput ids={effectsOverSlide} transition={transitions.overlay} {mirror} />
        {/if}

        <!-- overlays -->
        <!-- outOverlays?.length -->
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}
    {/if}

    {#if actualSlide?.attributionString && layers.includes("slide")}
        {#if mirror}
            <p class="attributionString">{actualSlide.attributionString.slice(0, 135)}</p>
        {:else}
            <p class="attributionString" transition:customTick={transitions.text}>{actualSlide.attributionString.slice(0, 135)}</p>
        {/if}
    {/if}

    <!-- draw -->
    {#if zoomActive}
        <Draw />
    {/if}
</Zoomed>

<style>
    .attributionString {
        position: absolute;
        bottom: 15px;
        left: 50%;
        transform: translateX(-50%);

        font-size: 28px;
        font-style: italic;
        opacity: 0.7;
    }
</style>
