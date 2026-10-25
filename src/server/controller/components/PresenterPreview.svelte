<script lang="ts">
    import { getItemWithMostLines, getOutputLineWindow, getRevealLineWindow } from "../../../common/outputLineWindows"
    import type { ControllerPresenterPreview } from "../../../types/remote/control"
    import Textbox from "../../remote/components/show/Textbox.svelte"
    import Zoomed from "../../remote/components/show/Zoomed.svelte"

    type PreviewData = ControllerPresenterPreview & { assets?: Record<string, string> }
    type Playback = NonNullable<PreviewData["playback"]>

    export let preview: PreviewData | null = null
    export let thumbnails: Record<string, string> = {}

    $: resolution = preview?.slide?.settings?.resolution || { width: 1920, height: 1080 }
    $: backgroundKey = (preview?.layoutSlide as any)?.data?.background || (preview?.layoutSlide as any)?.background || preview?.slide?.settings?.backgroundImage || ""
    $: backgroundPath = backgroundKey ? mediaPath(backgroundKey) : ""
    $: backgroundSource = thumbnails && backgroundPath ? imageSource(backgroundPath, backgroundKey) : ""
    $: backgroundFit = (preview?.media as any)?.[backgroundKey]?.fit || "contain"
    $: mediaSources = preview && thumbnails ? getMediaSources(preview) : {}
    $: clickRevealed = !!preview?.playback?.itemClickReveal

    function mediaPath(key: string) {
        return (preview?.media as any)?.[key]?.path || key
    }

    function imageSource(path: string, key = "") {
        const assetId = preview?.assets?.[path] || preview?.assets?.[key]
        if (assetId && thumbnails[assetId]) return thumbnails[assetId]
        if (/^(data|blob|https?):/i.test(path)) return path
        return ""
    }

    function getMediaSources(current: PreviewData) {
        const sources: Record<string, string> = {}
        for (const item of current.slide.items || []) {
            if (item.type !== "media" || !item.src) continue
            const path = mediaPath(item.src)
            const source = imageSource(path, item.src)
            if (source) sources[item.src] = source
        }
        return sources
    }

    function getItemLineWindow(current: PreviewData, item: any) {
        const playback = current.playback as Playback | undefined
        const styleLines = Number(playback?.styleLines || 0)
        if (item.lineReveal) return getRevealLineWindow(playback?.revealCount || 0, styleLines)
        if (!playback || !styleLines) return null

        const maxLines = getItemWithMostLines(current.slide)
        if (!maxLines) return null

        const line = playback.line || 0
        return getOutputLineWindow({ line, maxLines, styleLines, amountOfLinesToShow: styleLines, highestLinePos: line })
    }
</script>

{#if preview}
    <div class="preview-frame">
        <Zoomed {resolution} background={preview.slide.settings?.color || "black"}>
            {#if backgroundSource}
                <img class="background-image" src={backgroundSource} alt="" draggable="false" style={`width:${resolution.width}px;height:${resolution.height}px;object-fit:${backgroundFit};`} />
            {/if}
            {#each preview.slide.items || [] as item, index (`${item.id || item.src || "item"}-${index}`)}
                {@const lineWindow = getItemLineWindow(preview, item)}
                <Textbox {item} {mediaSources} {clickRevealed} {lineWindow} />
            {/each}
        </Zoomed>
    </div>
{:else}
    <div class="preview-frame preview-empty">No slide preview</div>
{/if}

<style>
    .preview-frame {
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 5px;
        background: #000;
    }

    .preview-empty {
        display: grid;
        place-items: center;
        color: #c5b5b5;
        font-size: 0.8rem;
    }

    .preview-frame :global(.slide) {
        width: 100%;
        height: 100%;
    }

    .background-image {
        position: absolute;
        top: 0;
        left: 0;
    }
</style>
