<script lang="ts">
    import { analyzeLyricsText, DEFAULT_MAX_LINE_LENGTH } from "../../../common/lyrics/analyzeLyricsText"
    import type { Show } from "../../../types/Show"
    import { getQuickExample } from "../../converters/txt"
    import { activePopup, labelsDisabled, textEditZoom } from "../../stores"
    import { transposeText } from "../../utils/chordTranspose"
    import { newToast } from "../../utils/common"
    import Icon from "../helpers/Icon.svelte"
    import T from "../helpers/T.svelte"
    import FloatingInputs from "../input/FloatingInputs.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialZoom from "../inputs/MaterialZoom.svelte"
    import { formatText } from "./formatTextEditor"
    import { getPlainEditorText } from "./getTextEditor"
    import HighlightedNotes from "./tools/HighlightedNotes.svelte"

    export let currentShow: Show | undefined

    let text = ""
    // live copy of what is typed, used only for the help, count and preview (never written to the show)
    let draft = ""
    $: if (currentShow) {
        text = getPlainEditorText()
        draft = text
    }

    $: analysis = analyzeLyricsText(draft)
    $: longLines = analysis.longLines
    $: shownLongLines = longLines.slice(0, 5)

    $: hasLockedSlide = Object.values(currentShow?.slides || {}).some((a) => a?.locked)
    $: isLocked = currentShow?.locked || hasLockedSlide
    $: if (isLocked) newToast("output.state_locked")

    // Ctrl+F in shortcuts.ts does not get triggered when a text input is active, so we trigger from here as well
    function keydown(e: any) {
        if (!e.ctrlKey && !e.metaKey) return
        if (e.key === "f") activePopup.set("find_replace")
    }

    // transpose chords
    function transposeUp() {
        formatText(transposeText(text, 1))
    }
    function transposeDown() {
        formatText(transposeText(text, -1))
    }

    $: showHasChords = Object.values(currentShow?.slides || {}).some((a) => a?.items?.some((a) => a.lines?.some((a) => a.chords)))
</script>

<div class="split">
    <div class="editor">
        <div class="info">
            <p class="help"><T id="edit.lyrics_help" /></p>
            <p class="count"><T id={analysis.slideCount === 1 ? "edit.lyrics_slide_count_one" : "edit.lyrics_slide_count"} replace={[String(analysis.slideCount)]} /></p>
            {#if longLines.length}
                <ul class="warnings">
                    {#each shownLongLines as warning}
                        <li><Icon id="warning" size={0.9} white /> <T id="edit.lyrics_long_line" replace={[String(warning.slide), String(warning.line), String(warning.length)]} /></li>
                    {/each}
                    {#if longLines.length > shownLongLines.length}
                        <li><T id="edit.lyrics_long_line_more" replace={[String(longLines.length - shownLongLines.length)]} /></li>
                    {/if}
                </ul>
            {/if}
        </div>

        <HighlightedNotes class="context #editbox_text" disabled={isLocked} style="padding: 30px;padding-bottom: 60px;font-size: {$textEditZoom / 8}em;" placeholder={getQuickExample()} value={text} on:edit={(e) => (draft = e.detail)} on:change={(e) => formatText(e.detail)} on:keydown={keydown} />
    </div>

    <aside class="preview" aria-label="Preview">
        {#if !$labelsDisabled}<h4><T id="edit.lyrics_preview" /></h4>{/if}
        {#if analysis.slideCount}
            <div class="slides">
                {#each analysis.slides as slide (slide.index)}
                    <div class="slide">
                        {#if slide.isExplicitGroup || slide.index === 1}
                            <span class="group">{slide.group || analysis.groups[0]?.name}</span>
                        {/if}
                        {#each slide.lines as line}
                            <p class:long={line.length > DEFAULT_MAX_LINE_LENGTH}>{line || " "}</p>
                        {/each}
                    </div>
                {/each}
            </div>
        {:else}
            <p class="empty"><T id="edit.lyrics_preview_empty" /></p>
        {/if}
    </aside>
</div>

<FloatingInputs side="left">
    {#if showHasChords}
        <MaterialButton on:click={transposeUp} title="edit.transpose_up">
            <Icon id="arrow_up" size={1.3} white />
        </MaterialButton>
        <MaterialButton on:click={transposeDown} title="edit.transpose_down">
            <Icon id="arrow_down" size={1.3} white />
        </MaterialButton>
    {/if}

    <MaterialZoom hidden={showHasChords} columns={$textEditZoom / 10} min={0.5} max={2} defaultValue={1} addValue={-0.1} on:change={(e) => textEditZoom.set(e.detail * 10)} />
</FloatingInputs>

<style>
    .split {
        flex: 1;
        min-height: 0;
        display: flex;
    }

    .editor {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    .info {
        padding: 6px 30px 0;
        font-size: 0.8em;
        opacity: 0.8;
    }

    .info p {
        margin: 0;
    }

    .warnings {
        margin: 4px 0 0;
        padding: 0;
        list-style: none;
        color: var(--secondary);
    }

    .preview {
        width: 32%;
        min-width: 220px;
        overflow-y: auto;
        padding: 10px;
        border-left: 2px solid var(--primary-lighter);
        background-color: var(--primary-darker);
    }

    .preview h4 {
        margin: 0 0 8px;
        font-size: 0.8em;
        text-transform: uppercase;
        opacity: 0.6;
    }

    .slides {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .slide {
        padding: 8px 10px;
        border-radius: 4px;
        background-color: var(--primary);
    }

    .slide p {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .slide p.long {
        color: var(--secondary);
    }

    .group {
        display: block;
        margin-bottom: 4px;
        font-size: 0.75em;
        opacity: 0.6;
    }

    .empty {
        opacity: 0.5;
    }
</style>
