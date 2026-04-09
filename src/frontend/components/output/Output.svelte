<!-- Used in output window, and currently in draw! -->
<svelte:options immutable={true} />

<script lang="ts">
    import { onDestroy } from "svelte"
    import { uid } from "uid"
    import { OutData } from "../../../types/Output"
    import type { Styles } from "../../../types/Settings"
    import type { AnimationData, Item, LayoutRef, OutBackground, OutSlide, Slide, SlideData, Template, Overlays as TOverlays } from "../../../types/Show"
    import { allOutputs, colorbars, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../stores"
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

    $: currentOutput = $outputs[outputId] || $allOutputs[outputId] || {}

    // --- Cheap change-detection signatures ---------------------------------------------------
    // Previous code used JSON.stringify on every reactive tick to detect "did this object change?"
    // That was O(n) per tick for `out`, `slide`, `background`, `currentStyling`. With ~6 reactive
    // blocks doing this per output, slide changes were hammering the main thread on large scripture
    // slides. These helpers replace the stringify comparisons with O(~10) signature functions that
    // cover every field that actually matters for the downstream reactives.

    function joinArr(a: any[] | undefined | null): string {
        return a ? a.join("|") : ""
    }
    function slideSig(s: any): string {
        if (!s) return ""
        return `${s.id || ""}|${s.layout || ""}|${s.index ?? -1}|${s.line ?? 0}|${s.type || ""}|${s.tempItems ? s.tempItems.length : 0}`
    }
    function backgroundSig(b: any): string {
        if (!b) return ""
        return `${b.path || b.id || ""}|${b.type || ""}|${b.muted ? 1 : 0}|${b.loop !== false ? 1 : 0}|${b.ignoreLayer ? 1 : 0}|${b.fit || ""}|${b.name || ""}`
    }
    function outSig(o: any): string {
        if (!o) return "::"
        return `${slideSig(o.slide)}::${backgroundSig(o.background)}::${joinArr(o.overlays)}::${joinArr(o.effects)}::${o.refresh || 0}::${o.transparent ? 1 : 0}`
    }
    function styleSig(s: any): string {
        if (!s) return ""
        const trans = s.transition ? `${s.transition.text?.type || ""}:${s.transition.text?.duration || 0}|${s.transition.media?.type || ""}:${s.transition.media?.duration || 0}` : ""
        const crop = s.cropping ? `${s.cropping.top || 0},${s.cropping.right || 0},${s.cropping.bottom || 0},${s.cropping.left || 0}` : ""
        const ar = s.aspectRatio ? `${s.aspectRatio.alignPosition || ""}:${s.aspectRatio.enabled ? 1 : 0}` : ""
        return `${s.name || ""}|${joinArr(s.layers)}|${s.background || ""}|${s.backgroundImage || ""}|${s.clearStyleBackgroundOnText ? 1 : 0}|${s.fit || ""}|${s.blurAmount || 0}|${s.blurOpacity || 0}|${s.volume || 0}|${ar}|${crop}|${s.lines || 0}|${s.template || ""}|${s.templateScripture || ""}|${trans}`
    }

    // output styling
    $: currentStyling = getCurrentStyle($styles, styleIdOverride || currentOutput.style)
    let currentStyle: Styles = { name: "" }
    let lastCurrentStylingRef: any = undefined
    let lastCurrentStyleSig = ""
    // Reference check short-circuits when the underlying store entry hasn't been touched (common
    // case — slide changes don't mutate style). Only pay the signature cost when the upstream
    // reference actually changes.
    $: if (currentStyling !== lastCurrentStylingRef) {
        lastCurrentStylingRef = currentStyling
        const sig = styleSig(currentStyling)
        if (sig !== lastCurrentStyleSig) {
            lastCurrentStyleSig = sig
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
    $: if (currentOutput && joinArr(layers) !== joinArr(currentStyle.layers || defaultLayers)) setNewLayers()
    function setNewLayers() {
        layers = clone(Array.isArray(currentStyle.layers) ? currentStyle.layers : defaultLayers)
        if (!Array.isArray(layers)) layers = []
    }

    let lastOutSig = "::"
    $: {
        const targetOut = outOverride || currentOutput?.out || {}
        const sig = outSig(targetOut)
        if (sig !== lastOutSig) {
            lastOutSig = sig
            out = clone(targetOut)
        }
    }

    let lastSlideSig = ""
    $: {
        const sig = slideSig(out.slide || null)
        if (sig !== lastSlideSig) {
            lastSlideSig = sig
            updateOutData("slide")
        }
    }
    let lastBgSig = ""
    $: {
        const sig = backgroundSig(out.background || null)
        if (sig !== lastBgSig) {
            lastBgSig = sig
            updateOutData("background")
        }
    }

    $: refreshOutput = out.refresh
    $: if (outputId || refreshOutput) updateOutData()
    // sig matching slideSig() but without the `line` field — used to decide whether a line-only
    // change on a different slide should refresh content (answer: no, skip the refresh).
    function slideSigNoLine(s: any): string {
        if (!s) return ""
        return `${s.id || ""}|${s.layout || ""}|${s.index ?? -1}|${s.type || ""}|${s.tempItems ? s.tempItems.length : 0}`
    }
    function updateOutData(type = "") {
        if (!type || type === "slide") {
            // don't refresh if changing lines on another slide & content is unchanged.
            if (!refreshOutput && !out?.slide?.type && lines[currentLineId || ""]?.start === null && slideSigNoLine(slide) === slideSigNoLine(out?.slide)) return

            slide = clone(out.slide || null)
        }
        if (!type || type === "background") background = clone(out.background || null)
        if (!type || type === "overlays") {
            // Use join("|") for arrays — cheap O(n) no stringify overhead.
            // For $overlays comparison (object dict), compare sorted keys since we only care about
            // add/remove; content changes are handled by individual overlay reactives elsewhere.
            storedOverlayIds = joinArr(out.overlays)
            const overlaysKeys = Object.keys($overlays).sort().join("|")
            if (overlaysKeys !== storedOverlays) {
                clonedOverlays = clone($overlays)
                storedOverlays = overlaysKeys
            }
        }
    }

    // overlays
    $: overlayIds = out.overlays
    let storedOverlayIds = ""
    let storedOverlays = ""
    $: if (joinArr(overlayIds) !== storedOverlayIds) updateOutData("overlays")
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

        // don't refresh content unless it changes.
        // Previous code cloned + setTemplateStyle + stringified both sides on every call. For scripture
        // slides with 20 translations this was ~300ms of pure CPU. Use an item-shape signature that
        // catches every layout-affecting change without deep serialization.
        let newCurrentSlide = getCurrentSlide()
        const slideItemsSig = (s: any) => {
            if (!s?.items) return ""
            let sig = ""
            for (let i = 0; i < s.items.length; i++) {
                const it = s.items[i]
                if (!it) { sig += "|"; continue }
                const linesLen = it.lines?.length || 0
                const firstText = it.lines?.[0]?.text?.[0]?.value?.slice(0, 24) || ""
                sig += `|${it.type || ""}:${linesLen}:${firstText.length}:${firstText}:${(it.style || "").length}`
            }
            return sig
        }
        const newSig = slideItemsSig(newCurrentSlide)
        const curSig = slideItemsSig(currentSlide)
        if (newSig !== curSig) currentSlide = newCurrentSlide

        function getCurrentSlide() {
            if (!slide && !outputId) return null
            if (slide.id === "temp" || slide.id === "tempText") return { items: slide.tempItems }
            if (!currentLayout) return null

            let slideId: string = currentLayout[slide?.index]?.id || ""
            return clone(_show(slide.id).slides([slideId]).get()[0] || {})
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
    $: metadataItems = getMetadata($showsCache[(slide as any)?.id || ""], currentStyle, slide, $templates)
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
