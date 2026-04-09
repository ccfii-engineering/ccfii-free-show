<!-- Used in output window, and currently in draw! -->
<!--
    NOTE: immutable is NOT safe on Output.svelte yet. The component has a complex reactive
    graph with JSON-gated internal variables (out, slide, background, layers) that interact
    poorly with immutable's === checks. Specifically, downstream reactives that depend on
    sub-properties (out.slide, currentStyle.transition) don't re-fire when the parent ref
    is unchanged even though the sub-property changed. The per-entry store migration below
    already provides the bulk of the reactive-storm reduction; immutable is deferred until
    the internal JSON gates are replaced with per-field derived stores.
-->

<script lang="ts">
    import { onDestroy } from "svelte"
    import { uid } from "uid"
    import type { OutData } from "../../../types/Output"
    import type { Styles } from "../../../types/Settings"
    import type { AnimationData, Item, LayoutRef, OutBackground, OutSlide, Slide, SlideData, Template, Overlays as TOverlays } from "../../../types/Show"
    import { allOutputs, colorbars, currentWindow, drawSettings, drawTool, effects, overlays, templates, transitionData } from "../../stores"
    import { mediaEntry, outputEntry, showEntry, styleEntry } from "../../utils/perEntryStores"
    import { wait } from "../../utils/common"
    import { customTick } from "../../utils/transitions"
    import Draw from "../draw/Draw.svelte"
    import { clone } from "../helpers/array"
    import { defaultLayers, getMetadata, getOutputLines, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../helpers/output"
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

    // Per-entry derived stores: each only wakes when THIS output/style entry changes, not on
    // unrelated mutations of the parent map. The factory clones on in-place mutation so
    // immutable subscribers always see a fresh reference.
    $: myOutput = outputEntry(outputId)
    $: currentOutput = $myOutput || $allOutputs[outputId] || {}

    // output styling — per-entry store dedupes and clones on in-place mutations, but we
    // still keep the JSON gate + clone for currentStyle to avoid downstream reactives firing
    // when the style content hasn't actually changed.
    $: myStyle = styleEntry(styleIdOverride || currentOutput.style || "")
    $: currentStyling = $myStyle || { name: "" }
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
        const target = JSON.stringify(currentStyle.layers || defaultLayers)
        if (target !== lastLayersJson) {
            lastLayersJson = target
            if (JSON.stringify(layers) !== target) setNewLayers()
        }
    }
    function setNewLayers() {
        layers = clone(Array.isArray(currentStyle.layers) ? currentStyle.layers : defaultLayers)
        if (!Array.isArray(layers)) layers = []
    }

    let lastOutJson = ""
    $: {
        const targetOut = outOverride || currentOutput?.out || {}
        const json = JSON.stringify(targetOut)
        if (json !== lastOutJson) {
            lastOutJson = json
            out = clone(targetOut)
        }
    }

    let lastSlideJson = ""
    $: {
        const json = JSON.stringify(out.slide || null)
        if (json !== lastSlideJson) {
            lastSlideJson = json
            updateOutData("slide")
        }
    }
    let lastBgJson = ""
    $: {
        const json = JSON.stringify(out.background || null)
        if (json !== lastBgJson) {
            lastBgJson = json
            updateOutData("background")
        }
    }

    $: refreshOutput = out.refresh
    $: if (outputId || refreshOutput) updateOutData()
    function updateOutData(type = "") {
        if (!type || type === "slide") {
            // don't refresh if changing lines on another slide & content is unchanged
            let noLineCurrent = clone(slide)
            if (noLineCurrent) delete noLineCurrent.line
            let noLineNew = clone(out?.slide)
            if (noLineNew) delete noLineNew.line
            if (!refreshOutput && !out?.slide?.type && lines[currentLineId || ""]?.start === null && JSON.stringify(noLineCurrent) === JSON.stringify(noLineNew)) return

            slide = clone(out.slide || null)
        }
        if (!type || type === "background") background = clone(out.background || null)
        if (!type || type === "overlays") {
            storedOverlayIds = JSON.stringify(out.overlays)
            if (JSON.stringify($overlays) !== storedOverlays) {
                clonedOverlays = clone($overlays)
                storedOverlays = JSON.stringify($overlays)
            }
        }
    }

    // overlays
    $: overlayIds = out.overlays
    let storedOverlayIds = ""
    let storedOverlays = ""
    $: if (JSON.stringify(overlayIds) !== storedOverlayIds) updateOutData("overlays")
    $: outOverlays = out.overlays?.filter((id) => !clonedOverlays?.[id]?.placeUnderSlide) || []
    $: outUnderlays = out.overlays?.filter((id) => clonedOverlays?.[id]?.placeUnderSlide) || []

    // layout & slide data
    let currentLayout: LayoutRef[] = []
    let slideData: SlideData | null = null
    let currentSlide: Slide | null = null

    $: updateSlideData(slide, outputId)
    function updateSlideData(slide, _outputChanged) {
        if (!slide) {
            currentLayout = []
            slideData = null
            currentSlide = null
            return
        }

        currentLayout = clone(_show(slide.id).layouts([slide.layout]).ref()[0] || [])
        slideData = currentLayout[slide?.index]?.data || null

        // don't refresh content unless it changes
        let newCurrentSlide = getCurrentSlide()
        if (JSON.stringify(formatSlide(newCurrentSlide)) !== JSON.stringify(currentSlide)) currentSlide = newCurrentSlide

        function getCurrentSlide() {
            if (!slide && !outputId) return null
            if (slide.id === "temp" || slide.id === "tempText") return { items: slide.tempItems }
            if (!currentLayout) return null

            let slideId: string = currentLayout[slide?.index]?.id || ""
            return clone(_show(slide.id).slides([slideId]).get()[0] || {})
        }

        // add template item keys to not update item when no changes is made (when custom style template is set)
        function formatSlide(currentSlide) {
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
        setTimeout(() => {
            lines[currentLineId] = getOutputLines(slide!, currentStyle.lines) // , currentSlide
        }, updateLinesTime)
    }

    // metadata
    $: myShowForMetadata = showEntry((slide as any)?.id || "")
    $: metadataItems = getMetadata($myShowForMetadata, currentStyle, slide, $templates)
    let currentMetadataItems: Item[] = []
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

    // ANIMATE
    let animationData: AnimationData = {}
    let currentAnimationId = ""
    $: slideAnimation = slideData?.actions?.animate || null

    $: if (slide) stopAnimation()
    onDestroy(stopAnimation)
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
    $: myStyleBgMedia = mediaEntry(styleBackground || "")
    $: myTemplateBgMedia = mediaEntry(templateBackground || "")
    $: styleBackgroundData = { path: styleBackground, ...($myStyleBgMedia || {}), loop: true }
    $: templateBackgroundData = { path: templateBackground, loop: true, ...($myTemplateBgMedia || {}) }
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
