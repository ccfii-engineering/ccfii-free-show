<script lang="ts">
    import { onDestroy } from "svelte"
    import Button from "../../../common/components/Button.svelte"
    import Center from "../../../common/components/Center.svelte"
    import Dropdown from "../../../common/components/Dropdown.svelte"
    import Icon from "../../../common/components/Icon.svelte"
    import { translate } from "../../util/helpers"
    import { GetLayout } from "../../util/output"
    import { lyricsSaveMessage, saveLyrics } from "../../util/lyricsSave"
    import { send } from "../../util/socket"
    import { _set, activeShow, activeTab, dictionary, isCleared, isConnected, outLayout, outShow, outSlide, textCache, textDraft } from "../../util/stores"
    import Clear from "../show/Clear.svelte"
    import Slides from "../show/Slides.svelte"
    import AddGroups from "./AddGroups.svelte"
    import GroupsEdit from "./GroupsEdit.svelte"
    import TextEdit from "./TextEdit.svelte"

    // Memoize layout calculation
    $: layout = $outShow ? GetLayout($outShow, $outLayout) : null
    $: _set("layout", layout)

    $: slideNum = $outSlide ?? -1

    // Memoize totalSlides calculation
    $: totalSlides = layout ? layout.length : 0

    let scrollElem: HTMLElement | undefined
    let lyricsScroll: any
    // auto scroll - optimize with requestAnimationFrame
    let scrollRaf: number | null = null
    $: {
        if (lyricsScroll && slideNum !== null && $activeTab === "lyrics" && scrollRaf === null) {
            scrollRaf = requestAnimationFrame(() => {
                let offset = lyricsScroll.children[slideNum]?.offsetTop - lyricsScroll.offsetTop - 5
                lyricsScroll.scrollTo(0, offset)
                scrollRaf = null
            }) as unknown as number
        }
    }

    // Memoize layouts to avoid recalculation
    $: layouts = Object.entries($activeShow?.layouts || {}).map(([id, a]: any) => ({ id, name: a.name }))

    function changeLayout(e: any) {
        let layoutId = e.detail?.id
        send("API:change_layout", { showId: $activeShow?.id, layoutId })
    }

    // GROUPS EDIT

    let groupsOpened: boolean = false
    let addGroups: boolean = false

    // TEXT EDIT

    let editOpened: boolean = false
    let textValue = ""
    let editSeedValue = ""
    let saving = false
    let saveMessage = ""
    let saveMessageKind: "" | "saved" | "error" = ""
    let savedNote = ""
    let savedNoteTimeout: ReturnType<typeof setTimeout> | null = null

    // unsaved text survives a lost connection: the editor reopens with it once the show is back
    let draftChecked = false
    // (checked once, when the first show is known: later drafts are the ones being typed right now)
    $: if (!draftChecked && $activeShow?.id) {
        draftChecked = true
        if ($textDraft?.id === $activeShow.id) {
            editOpened = true
            textValue = $textDraft.value
            saveMessage = translate("edit.lyrics_draft_restored", $dictionary)
            saveMessageKind = ""
        }
    }

    $: {
        const showId = $activeShow?.id || ""

        if (!editOpened) {
            reset()
            editSeedValue = ""
        } else {
            const cachedText = $textCache[showId]
            // Only hydrate from cache while the draft is still untouched.
            if (typeof cachedText === "string" && textValue === editSeedValue && cachedText !== editSeedValue) {
                textValue = cachedText
                editSeedValue = cachedText
            }
        }
    }

    function reset() {
        textValue = ""
        saveMessage = ""
        saveMessageKind = ""
    }
    function done() {
        if (addGroups) {
            addGroups = false
            return
        }

        if (groupsOpened) {
            groupsOpened = false
            addGroups = false
            return
        }

        saveText()
    }

    // the main app answers saved or refused (locked, read-only); a refused save keeps the editor open with the text
    async function saveText() {
        const showId = $activeShow?.id || ""
        if (saving || !showId) return
        if ($textCache[showId] === textValue) {
            editOpened = false
            textDraft.set(null)
            return
        }

        saving = true
        const outcome = await saveLyrics(showId, textValue)
        saving = false

        if (outcome.status !== "saved") {
            saveMessage = lyricsSaveMessage(outcome, $dictionary)
            saveMessageKind = "error"
            return
        }

        textDraft.set(null)
        editOpened = false
        savedNote = lyricsSaveMessage(outcome, $dictionary)
        if (savedNoteTimeout) clearTimeout(savedNoteTimeout)
        savedNoteTimeout = setTimeout(() => (savedNote = ""), 4000)
    }

    function playSlide(index: number) {
        if (!$activeShow) return

        const showId = $activeShow.id
        const layoutId = $activeShow.settings.activeLayout

        if ($outShow && showId === $outShow.id && layoutId === $outShow.settings.activeLayout && index === slideNum) {
            // reveal lines if it exists
            const ref = GetLayout($activeShow, $activeShow?.settings?.activeLayout)
            const revealExists = $activeShow.slides[ref[index]?.id]?.items?.find((item) => item.lineReveal || item.clickReveal)
            if (revealExists) {
                send("API:next_slide") // , { onlyCurrentReveal: true }
            }
            return
        }

        send("API:index_select_slide", { showId, layoutId, index })
        _set("outShow", $activeShow)
        send("API:get_cleared")
    }

    // Cleanup scroll animation frame
    onDestroy(() => {
        if (scrollRaf !== null) {
            cancelAnimationFrame(scrollRaf)
        }
    })
</script>

<!-- GetLayout($activeShow, $activeShow?.settings?.activeLayout).length -->
{#if $activeShow?.layouts}
    <h2 class="header">{$activeShow.name || ""}</h2>

    {#if savedNote}
        <p class="saved-note" role="status" data-testid="lyrics-saved">{savedNote}</p>
    {/if}

    {#if (groupsOpened || editOpened) && !($activeShow.id === $outShow?.id)}
        {#if groupsOpened}
            {#if addGroups}
                <AddGroups show={$activeShow} on:added={() => (addGroups = false)} />
            {:else}
                <GroupsEdit show={$activeShow} />
            {/if}
        {:else}
            <TextEdit bind:value={textValue} message={saveMessage} messageKind={saveMessageKind} />
        {/if}

        <div class="buttons" style="position: relative; z-index: 2;">
            <div class="edit-actions">
                {#if groupsOpened && !addGroups}
                    <Button on:click={() => (addGroups = true)} style="width: 100%;" center dark>
                        <Icon id="add" right />
                        {translate("settings.add", $dictionary)}
                    </Button>
                {/if}

                <Button on:click={done} style="width: 100%;" center dark class="done-button" disabled={editOpened && !groupsOpened && (!$isConnected || saving)}>
                    <Icon id={addGroups ? "back" : "check"} right />
                    {translate(`actions.${addGroups ? "back" : "done"}`, $dictionary)}
                </Button>
            </div>
        </div>
    {:else}
        <div bind:this={scrollElem} class="scroll" style="background-color: var(--primary-darker);scroll-behavior: smooth;">
            <Slides {dictionary} {scrollElem} on:click={(e) => playSlide(e.detail)} outSlide={slideNum} />
        </div>

        {#if $activeShow.id === $outShow?.id || !$isCleared.all}
            {#if $activeShow.id === $outShow?.id}
                <div class="controls-section">
                    <div class="buttons">
                        {#key slideNum}
                            <Clear outSlide={slideNum} />
                        {/key}
                    </div>

                    <div class="slide-progress">
                        <Button on:click={() => send("API:previous_slide")} disabled={slideNum <= 0} variant="outlined" center compact>
                            <Icon id="previous" size={1.2} />
                        </Button>
                        <span class="counter">{slideNum + 1}/{totalSlides}</span>
                        <Button on:click={() => send("API:next_slide")} disabled={slideNum + 1 >= totalSlides} variant="outlined" center compact>
                            <Icon id="next" size={1.2} />
                        </Button>
                    </div>
                </div>
            {:else}
                <div class="buttons">
                    {#key slideNum}
                        <Clear outSlide={slideNum} />
                    {/key}
                </div>
            {/if}
        {:else}
            <div class="buttons">
                {#if layouts.length > 1}
                    {@const currentLayout = layouts.find((a) => a.id == $activeShow.settings?.activeLayout)}
                    <Dropdown value={currentLayout?.name || "—"} options={layouts} on:click={changeLayout} style="width: 100%;" up />
                {/if}

                <div class="edit">
                    <Button on:click={() => (groupsOpened = true)} style="width: 100%;" center dark>
                        <Icon id="groups" right />
                        {translate("tools.groups", $dictionary)}
                    </Button>
                    <Button on:click={() => (editOpened = true)} style="width: 100%;" center dark>
                        <Icon id="edit" right />
                        {translate("titlebar.edit", $dictionary)}
                    </Button>
                </div>
            </div>
        {/if}
    {/if}
{:else}
    <Center faded>{translate("empty.slides", $dictionary)}</Center>
{/if}

<style>
    .saved-note {
        margin: 0;
        padding: 8px 12px;
        white-space: normal;
        font-size: 0.9em;
        background-color: var(--operator-raised, var(--primary-lighter));
        border-left: 3px solid var(--operator-amber, #faa739);
    }

    .controls-section {
        display: flex;
        flex-direction: column;
        gap: 0;
        background-color: var(--primary-darkest);
        border-radius: 8px 8px 0 0;
        overflow: hidden;
        margin-bottom: 0;
    }

    .controls-section .buttons {
        border-radius: 8px 8px 0 0;
    }

    .controls-section :global(.clearAll) {
        border-radius: 8px 8px 0 0 !important;
    }

    .slide-progress {
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        gap: 12px;
        padding: 2px 6px;
        background-color: var(--primary-darkest);
        border-radius: 0;
        min-height: 36px;
    }

    .slide-progress :global(button) {
        min-width: 32px;
        min-height: 32px !important;
        padding: 2px 6px !important;
        flex-shrink: 0;
    }

    .slide-progress :global(button) :global(svg) {
        fill: var(--accent);
    }

    .slide-progress .counter {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        color: white;
        font-size: 0.85em;
        font-weight: 700;
        padding: 0 8px;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.3px;
        pointer-events: none;
    }

    .scroll {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        /* FreeShow UI scrollbar */
        scrollbar-width: thin; /* Firefox */
        scrollbar-color: rgb(255 255 255 / 0.3) rgb(255 255 255 / 0.05);
    }
    .scroll::-webkit-scrollbar {
        width: 8px;
        height: 8px;
    }
    .scroll::-webkit-scrollbar-track,
    .scroll::-webkit-scrollbar-corner {
        background: rgb(255 255 255 / 0.05);
    }
    .scroll::-webkit-scrollbar-thumb {
        background: rgb(255 255 255 / 0.3);
        border-radius: 8px;
    }
    .scroll::-webkit-scrollbar-thumb:hover {
        background: rgb(255 255 255 / 0.5);
    }

    @media screen and (max-width: 1000px) {
        .scroll {
            background-color: var(--primary) !important;
        }

        .slide-progress {
            padding-top: 8px;
            padding-bottom: 8px;
        }
    }

    .edit-actions :global(.done-button) {
        border-radius: 8px 8px 0 0 !important;
    }
</style>
