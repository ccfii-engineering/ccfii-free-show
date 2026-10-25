<script lang="ts">
    import type { Item } from "../../../../types/Show"
    import autosize, { AutosizeTypes } from "../../../common/util/autosize"
    import { createVirtualBreaks } from "../../../common/util/show"
    import { getStyles } from "../../../common/util/style"
    import { send } from "../../util/socket"
    import { mediaCache } from "../../util/stores"
    import Icon from "../../../common/components/Icon.svelte"

    export let item: Item
    export let mediaSources: Record<string, string> | undefined = undefined
    export let revealed: number | null = null
    export let clickRevealed = true
    export let lineWindow: { start: number | null; end: number | null } | null = null

    const requestedThumbnails = new Set<string>()
    const isDirectMediaPath = (path: string) => /^(data|blob|https?):/i.test(path)

    $: {
        const path = item?.type === "media" ? item.src || "" : ""
        if (mediaSources === undefined && path && !isDirectMediaPath(path) && !$mediaCache[path] && !requestedThumbnails.has(path)) {
            requestedThumbnails.add(path)
            send("API:get_thumbnail", { path })
        }
    }
    $: mediaSource = item?.src ? (mediaSources === undefined ? $mediaCache[item.src] || item.src : mediaSources[item.src] || "") : ""

    function visibleLines(lines: any[] = []) {
        return createVirtualBreaks(lines)
            .map((line, index) => ({ line, index }))
            .filter(({ index }) => {
                if (lineWindow && ((lineWindow.start !== null && index < lineWindow.start) || (lineWindow.end !== null && index >= lineWindow.end))) return false
                return !item?.lineReveal || revealed === null || index <= revealed
            })
    }

    $: lineGap = item?.specialStyle?.lineGap
    $: lineRadius = item?.specialStyle?.lineRadius || 0
    $: lineBg = item?.specialStyle?.lineBg
    $: lineStyleBox = lineGap ? `gap: ${lineGap}px;` : ""
    $: lineStyle = (lineRadius ? `border-radius: ${lineRadius}px;` : "") + (lineBg ? `background: ${lineBg};` : "")

    // AUTO SIZE

    let fontSize: number = 0
    let itemElem: Element | null = null

    let previousItem = "{}"
    $: newItem = JSON.stringify(item)
    $: if (itemElem && newItem !== previousItem) calculateAutosize()

    let loopStop: any = null
    let newCall: boolean = false
    function calculateAutosize() {
        if (loopStop) {
            newCall = true
            return
        }
        loopStop = setTimeout(() => {
            loopStop = null
            if (newCall) calculateAutosize()
            newCall = false
        }, 200)
        previousItem = newItem

        let type = (item?.textFit || "shrinkToFit") as AutosizeTypes

        let defaultFontSize
        let maxFontSize

        if ((item.type || "text") === "text" && !item.auto) {
            fontSize = 0
            return
        }

        const textArray = Array.isArray(item?.lines?.[0]?.text) ? item.lines[0].text : []
        const itemText = textArray.filter((a) => !a.customType?.includes("disableTemplate")) || []
        let itemFontSize = Number(getStyles(itemText[0]?.style, true)?.["font-size"] || "") || 100

        defaultFontSize = itemFontSize
        if (type === "growToFit") maxFontSize = itemFontSize

        let elem = itemElem
        if (!elem) return

        let textQuery = ""
        if ((item.type || "text") === "text") {
            elem = elem.querySelector(".align")
            textQuery = ".lines .break span"
        } else {
            type = "growToFit"
            if (item.type === "slide_tracker") textQuery = ".progress div"
        }

        fontSize = autosize(elem as HTMLElement, { type, textQuery, defaultFontSize, maxFontSize })
    }

    function getCustomStyle(style: string) {
        // let outputResolution = // get actual output resolution
        // style = percentageStylePos(style, outputResolution)
        return style
    }
</script>

{#if !item.clickReveal || clickRevealed}
    <div class="item" style={getCustomStyle(item.style)} bind:this={itemElem}>
        {#if item.lines}
            <div class="align" style={item.align}>
                <div class="lines" style={lineStyleBox}>
                    {#each visibleLines(item.lines) as { line }}
                        <div class="break" style="{lineStyle}{line.align}">
                            {#each line.text || [] as text}
                                <span style="{text.style};{fontSize ? `font-size: ${fontSize}px;` : ''}">{@html text.value?.replaceAll("\n", "<br>") || "<br>"}</span>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {:else if item.type === "media" && item.src}
            {#if mediaSources === undefined || mediaSource}
                <img src={mediaSource} style="width:100%;height:100%;object-fit:{item.fit || 'contain'};" alt="" />
            {:else}
                <div class="unavailable-media"><Icon id="image" size={2.2} /></div>
            {/if}
        {:else if item.type === "icon" && item.customSvg}
            <div class="customSvg">{@html item.customSvg}</div>
        {/if}
    </div>
{/if}

<style>
    .align {
        height: 100%;
        display: flex;
        text-align: center;
        align-items: center;
    }

    .lines {
        /* overflow-wrap: break-word;
  font-size: 0; */
        width: 100%;

        display: flex;
        flex-direction: column;
        text-align: center;
        justify-content: center;
    }

    .break {
        width: 100%;

        font-size: 0; /* auto size fix */
        /* height: 100%; */

        overflow-wrap: break-word;
        /* line-break: after-white-space;
    -webkit-line-break: after-white-space; */

        text-wrap: balance; /* balanced breaking, looks much cleaner */
        white-space: pre-wrap; /* preserve special spaces from Text edit */
    }

    .break span {
        font-size: 100px;
    }

    /* span {
    display: inline;
    white-space: initial;
    color: white;
  } */

    .customSvg {
        width: 100%;
        height: 100%;
    }
    .customSvg :global(svg) {
        width: 100%;
        height: 100%;
    }

    .unavailable-media {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
        color: #e3caa8;
        background: #2b2020;
    }
</style>
