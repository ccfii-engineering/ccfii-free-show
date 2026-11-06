<script lang="ts">
    import { analyzeLyricsText, DEFAULT_MAX_LINE_LENGTH } from "../../../../common/lyrics/analyzeLyricsText"
    import Button from "../../../common/components/Button.svelte"
    import Icon from "../../../common/components/Icon.svelte"
    import Textarea from "../../../common/components/Textarea.svelte"
    import { hasChords, transposeText } from "../../../common/util/transpose"
    import { translate, translateWith } from "../../util/helpers"
    import { send } from "../../util/socket"
    import { activeShow, dictionary, textCache, textDraft } from "../../util/stores"

    export let value: string
    /** answer to the last save (saved, refused, offline), shown under the help line */
    export let message = ""
    export let messageKind: "" | "saved" | "error" = ""

    $: id = $activeShow?.id
    $: if (id) getText()
    function getText() {
        send("API:get_plain_text", { id })
    }

    // Keep what is typed until it is saved: the Remote drops its views when the connection is lost
    $: if (id && value !== "" && value !== $textCache[id]) textDraft.set({ id, value })

    // Help, slide count, long-line warnings and the preview all come from the shared analyzer
    $: analysis = analyzeLyricsText(value || "")
    $: longLines = analysis.longLines
    $: shownLongLines = longLines.slice(0, 3)

    // Transpose functionality
    $: showTransposeButtons = hasChords(value)

    function transposeUp() {
        value = transposeText(value, 1)
    }

    function transposeDown() {
        value = transposeText(value, -1)
    }
</script>

<div class="editor-container">
    <div class="info">
        <p class="help" data-testid="lyrics-help">{translate("edit.lyrics_help", $dictionary)}</p>
        <p class="count" data-testid="lyrics-count">{translateWith(analysis.slideCount === 1 ? "edit.lyrics_slide_count_one" : "edit.lyrics_slide_count", [analysis.slideCount], $dictionary)}</p>
        {#if longLines.length}
            <ul class="warnings" data-testid="lyrics-warnings">
                {#each shownLongLines as warning}
                    <li>
                        <Icon id="warning" size={0.9} white />
                        <span>{translateWith("edit.lyrics_long_line", [warning.slide, warning.line, warning.length], $dictionary)}</span>
                    </li>
                {/each}
                {#if longLines.length > shownLongLines.length}
                    <li>{translateWith("edit.lyrics_long_line_more", [longLines.length - shownLongLines.length], $dictionary)}</li>
                {/if}
            </ul>
        {/if}
        {#if message}
            <p class="message {messageKind}" role="status" data-testid="lyrics-message">{message}</p>
        {/if}
    </div>

    <div class="split">
        <div class="editor">
            <Textarea bind:value />

            {#if showTransposeButtons}
                <div class="transpose-buttons">
                    <Button on:click={transposeUp} title={translate("edit.transpose_up", $dictionary)} dark>
                        <Icon id="up" size={1.3} />
                    </Button>
                    <Button on:click={transposeDown} title={translate("edit.transpose_down", $dictionary)} dark>
                        <Icon id="down" size={1.3} />
                    </Button>
                </div>
            {/if}
        </div>

        <aside class="preview" aria-label={translate("edit.lyrics_preview", $dictionary)} data-testid="lyrics-preview">
            <h4>{translate("edit.lyrics_preview", $dictionary)}</h4>
            {#if analysis.slideCount}
                <div class="slides">
                    {#each analysis.slides as slide (slide.index)}
                        <div class="slide" data-testid="lyrics-preview-slide">
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
                <p class="empty">{translate("edit.lyrics_preview_empty", $dictionary)}</p>
            {/if}
        </aside>
    </div>
</div>

<style>
    .editor-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        flex: 1;
        position: relative;
        z-index: 1;
        /* the preview sits beside the text only when the panel is wide enough (iPad), and below it is dropped (phone) */
        container-type: inline-size;
    }

    .info {
        flex-shrink: 0;
        padding: 8px 12px;
        font-size: 0.85em;
        background-color: var(--primary-darker);
        border-radius: 8px 8px 0 0;
        border: 1px solid var(--primary-lighter);
        border-bottom: none;
    }

    /* global p styles truncate to one line; the help text must wrap */
    .info p {
        margin: 0;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
    }
    .help {
        opacity: 0.8;
    }
    .count {
        margin-top: 2px;
        font-weight: 600;
    }

    .warnings {
        margin: 4px 0 0;
        padding: 0;
        list-style: none;
        color: var(--operator-amber, var(--secondary));
    }
    .warnings li {
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }

    .message {
        margin-top: 6px !important;
        padding: 6px 10px;
        border-radius: 6px;
        background-color: var(--operator-raised, var(--primary-lighter));
    }
    .message.error {
        background-color: rgb(155 36 36 / 0.3);
        border-left: 3px solid var(--operator-crimson-strong, #9b2424);
    }
    .message.saved {
        border-left: 3px solid var(--operator-amber, #faa739);
    }

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
        position: relative;
    }

    .editor :global(textarea) {
        border-radius: 0 0 0 8px;
    }

    .preview {
        display: none;
        width: 40%;
        min-width: 190px;
        overflow-y: auto;
        padding: 10px;
        border: 1px solid var(--primary-lighter);
        border-left: none;
        border-radius: 0 0 8px 0;
        background-color: var(--primary-darker);
    }
    @container (min-width: 460px) {
        .preview {
            display: block;
        }
    }
    @container (max-width: 459px) {
        .editor :global(textarea) {
            border-radius: 0 0 8px 8px;
        }
    }

    .preview h4 {
        margin: 0 0 8px;
        font-size: 0.75em;
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
        overflow: visible;
        text-overflow: clip;
    }

    .slide p.long {
        color: var(--operator-amber, var(--secondary));
    }

    .group {
        display: block;
        margin-bottom: 4px;
        font-size: 0.75em;
        opacity: 0.6;
    }

    .empty {
        opacity: 0.5;
        white-space: normal;
    }

    .transpose-buttons {
        position: absolute;
        bottom: 10px;
        right: 10px;
        display: flex;
        gap: 4px;
        z-index: 10;
    }

    .transpose-buttons :global(button) {
        padding: 0.4em;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>
