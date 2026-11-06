<script lang="ts">
    import { _set, active, activeDrawerTab, activeProject, activeShow, createShow, dictionary, drawer, isConnected, outShow, outSlide, project, projectsOpened, selectedSlides, templateScope, textCache, textDraft } from "../../../util/stores"
    import { uid } from "uid"
    import { translate, throttle } from "../../../util/helpers"
    import { GetLayout } from "../../../util/output"
    import { lyricsSaveMessage, saveLyrics } from "../../../util/lyricsSave"
    import { send } from "../../../util/socket"

    import Slides from "../../show/Slides.svelte"
    import ShowContent from "../../pages/ShowContent.svelte"
    import AddGroups from "../../pages/AddGroups.svelte"
    import GroupsEdit from "../../pages/GroupsEdit.svelte"
    import TextEdit from "../../pages/TextEdit.svelte"
    import Button from "../../../../common/components/Button.svelte"
    import Icon from "../../../../common/components/Icon.svelte"
    import { getGroupName } from "../../../../common/util/show"

    // Logic from TabletMode.svelte

    $: outNumber = $outSlide ?? -1

    // Slide View / Grid View toggle
    const slidesViews: any = { grid: "lyrics", lyrics: "grid" }
    let slideView: string = "grid"

    // Groups / Edit logic
    let groupsOpened: boolean = false
    let addGroups: boolean = false
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
    function cancel() {
        editOpened = false
        textDraft.set(null)
        reset()
    }

    // the main app answers saved or refused (locked, read-only); a refused save keeps the editor open with the text
    async function save() {
        const showId = $activeShow?.id || ""
        if (saving || !showId) return
        if ($textCache[showId] === textValue) return cancel()

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
    }

    function getName(group: string, layoutSlideId: string, index: number) {
        const name = $activeShow ? getGroupName({ show: $activeShow, showId: $activeShow?.id || "" }, layoutSlideId, group, index, true) : ""
        return name || "—"
    }

    // the Templates drawer's "Selected slides" scope turns a tap on a slide into a pick instead of a play,
    // but only while that tab is showing in an open drawer (the tabs stay mounted behind the scenes)
    const drawerMinHeight = 40
    $: drawerOpen = ($drawer.height ?? 400) > drawerMinHeight
    $: templatesVisible = drawerOpen && $activeDrawerTab === "templates"
    $: picking = templatesVisible && $templateScope === "slides"
    // minimizing the drawer or leaving the tab ends the picking: scope and picks reset so a tap plays again
    $: if (!templatesVisible && $templateScope === "slides") {
        templateScope.set("show")
        selectedSlides.set([])
    }
    // picks belong to one show
    let pickShowId = ""
    $: if (($activeShow?.id || "") !== pickShowId) {
        pickShowId = $activeShow?.id || ""
        selectedSlides.set([])
    }

    function toggleSlide(index: number) {
        selectedSlides.update((a) => (a.includes(index) ? a.filter((i) => i !== index) : [...a, index].sort((x, y) => x - y)))
    }

    function playSlide(index: number) {
        if (!$activeShow) return
        if (picking) return toggleSlide(index)

        const showId = $activeShow.id
        const layoutId = $activeShow.settings.activeLayout

        if ($outShow && showId === $outShow.id && layoutId === $outShow.settings.activeLayout && index === outNumber) {
            // reveal lines if it exists
            const ref = GetLayout($activeShow, $activeShow?.settings?.activeLayout)
            const revealExists = $activeShow.slides[ref[index]?.id]?.items?.find((item) => item.lineReveal || item.clickReveal)
            if (revealExists) {
                send("API:next_slide")
            }
            return
        }

        send("API:index_select_slide", { showId, layoutId, index })
        _set("outShow", $activeShow)
    }

    function changeLayout(layoutId: string) {
        send("API:change_layout", { showId: $activeShow?.id, layoutId })
    }

    let scrollElem: HTMLElement | undefined
    let scrollRaf: number | null = null
    let userScrolled = false
    let scrollTimeout: number | null = null
    let lastSlideNumber = -1
    let lastAutoScrollTime = 0

    function newShowCTA() {
        _set("activeTab", "shows")
        createShow.set(true)
    }

    function newProjectCTA() {
        _set("activeTab", "project")

        const name = prompt(translate("new.project", $dictionary) || "New project")
        if (!name) return

        const projectId = uid()
        send("API:create_project", { name, id: projectId })
        projectsOpened.set(false)
        project.set(projectId)
        activeProject.set({ id: projectId, name, parent: "/", shows: [] } as any)
    }

    // Detect manual scrolling - disable auto-scroll temporarily
    function handleScroll() {
        if (!scrollElem || slideView !== "lyrics") return

        // If scroll happens more than 300ms after auto-scroll, it's user scroll
        if (Date.now() - lastAutoScrollTime > 300) {
            userScrolled = true
            if (scrollTimeout !== null) clearTimeout(scrollTimeout)
            // Re-enable auto-scroll after 4 seconds
            scrollTimeout = setTimeout(() => {
                userScrolled = false
                scrollTimeout = null
            }, 4000) as unknown as number
        }
    }

    // Throttled version for better mobile performance (max once per 100ms)
    const handleScrollThrottled = throttle(handleScroll, 100)

    // Auto-scroll to current slide
    $: {
        if (scrollElem && outNumber !== null && slideView === "lyrics" && scrollRaf === null && outNumber !== lastSlideNumber) {
            // Reset flag when slide changes
            if (lastSlideNumber !== -1) {
                userScrolled = false
                if (scrollTimeout !== null) {
                    clearTimeout(scrollTimeout)
                    scrollTimeout = null
                }
            }

            // Auto-scroll if user hasn't manually scrolled
            if (!userScrolled) {
                const elem = scrollElem
                const targetSlide = outNumber
                lastSlideNumber = targetSlide

                scrollRaf = requestAnimationFrame(() => {
                    if (!elem || userScrolled) {
                        scrollRaf = null
                        return
                    }
                    const offset = (elem.children[targetSlide] as HTMLElement)?.offsetTop - elem.offsetTop - 5
                    elem.scrollTo({ top: offset - 50, behavior: "smooth" })
                    lastAutoScrollTime = Date.now()
                    scrollRaf = null
                }) as unknown as number
            } else {
                lastSlideNumber = outNumber
            }
        }
    }
    $: layoutSlides = $activeShow ? GetLayout($activeShow, $activeShow?.settings?.activeLayout) : []
</script>

<div class="center-panel">
    {#if ($active.type || "show") === "show"}
        {#if $activeShow}
            <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
                {#if groupsOpened || editOpened}
                    {#if groupsOpened}
                        {#if addGroups}
                            <AddGroups show={$activeShow} on:added={() => (addGroups = false)} />
                        {:else}
                            <GroupsEdit show={$activeShow} />
                        {/if}
                    {:else}
                        <TextEdit bind:value={textValue} message={saveMessage} messageKind={saveMessageKind} />
                    {/if}
                {:else}
                    {#if savedNote}
                        <p class="saved-note" role="status" data-testid="lyrics-saved">{savedNote}</p>
                    {/if}
                    <div bind:this={scrollElem} on:scroll={handleScrollThrottled} class="scroll" style="flex: 1;min-height: 0;overflow-y: auto;background-color: var(--primary-darkest);scroll-behavior: smooth;display: flex;flex-direction: column;">
                        {#if slideView === "lyrics"}
                            {#each layoutSlides as layoutSlide, i (layoutSlide.id)}
                                {#if !layoutSlide.disabled}
                                    <span style="padding: 5px;{$outShow?.id === $activeShow.id && outNumber === i ? 'background-color: rgba(0 0 0 / 0.6);' : ''}" class:picked={picking && $selectedSlides.includes(i)} aria-pressed={picking ? $selectedSlides.includes(i) : undefined} role="button" tabindex="0" on:click={() => playSlide(i)} on:keydown={(e) => (e.key === "Enter" ? playSlide(i) : null)}>
                                        <span class="group" style="opacity: 0.6;font-size: 0.8em;display: flex;justify-content: center;position: relative;">
                                            <span style="left: 0;position: absolute;">{i + 1}</span>
                                            <span>{$activeShow.slides[layoutSlide.id].group === null ? "" : getName($activeShow.slides[layoutSlide.id].group || "", layoutSlide.id, i)}</span>
                                        </span>
                                        {#each $activeShow.slides[layoutSlide.id].items as item}
                                            {#if item.lines}
                                                <div class="lyric" style="font-size: 1.1em;text-align: center;">
                                                    {#each item.lines as line}
                                                        <div class="break">
                                                            {#each line.text || [] as text}
                                                                <span>{@html text.value}</span>
                                                            {/each}
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <span style="opacity: 0.5;">—</span>
                                            {/if}
                                        {/each}
                                    </span>
                                {/if}
                            {/each}
                        {:else}
                            <Slides {dictionary} {scrollElem} on:click={(e) => playSlide(e.detail)} outSlide={outNumber} columns={3} {picking} picked={$selectedSlides} />
                        {/if}
                    </div>
                {/if}
            </div>

            <div class="layouts">
                <div style="display: flex;">
                    {#if !groupsOpened && !editOpened}
                        {#each Object.keys($activeShow.layouts || {}) as id}
                            {@const layout = $activeShow.layouts[id]}
                            <Button on:click={() => changeLayout(id)} active={$activeShow.settings?.activeLayout === id}>
                                {layout.name}
                            </Button>
                        {/each}
                    {/if}
                </div>

                <div class="buttons">
                    {#if groupsOpened}
                        {#if !addGroups}
                            <Button on:click={() => (addGroups = true)} variant="outlined" center>
                                <Icon id="add" />
                                {translate("settings.add", $dictionary)}
                            </Button>
                        {/if}

                        <Button on:click={done} dark center class="done-button">
                            <Icon id={addGroups ? "back" : "check"} />
                            {translate(`actions.${addGroups ? "back" : "done"}`, $dictionary)}
                        </Button>
                    {:else if editOpened}
                        <Button on:click={cancel} variant="outlined" center>
                            <Icon id="close" />
                            {translate("popup.cancel", $dictionary)}
                        </Button>
                        <Button on:click={save} dark center disabled={!$isConnected || saving}>
                            <Icon id="save" />
                            {translate("actions.save", $dictionary)}
                        </Button>
                    {:else}
                        <Button class="context #slideViews" on:click={() => (slideView = slidesViews[slideView])} variant="outlined">
                            <Icon size={1.3} id={slideView} white />
                        </Button>

                        <Button on:click={() => (groupsOpened = true)} variant="outlined" center class="toolButton">
                            <Icon id="groups" />
                            {translate("tools.groups", $dictionary)}
                        </Button>

                        <Button on:click={() => (editOpened = true)} variant="outlined" center class="toolButton">
                            <Icon id="edit" />
                            {translate("titlebar.edit", $dictionary)}
                        </Button>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="empty-hero">
                <h1 class="hero-title">FreeShow Remote</h1>
                <p class="hero-edition">CCFII Edition</p>
                <div class="hero-actions">
                    <button class="hero-row" type="button" on:click={newProjectCTA}>
                        <Icon id="project" size={1.6} />
                        <span>{translate("new.project", $dictionary)}</span>
                    </button>
                    <button class="hero-row" type="button" on:click={newShowCTA}>
                        <Icon id="add" size={1.6} />
                        <span>{translate("new.show", $dictionary)}</span>
                    </button>
                </div>
            </div>
        {/if}
    {:else}
        <ShowContent tablet />
    {/if}
</div>

<style>
    .center-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        background-color: var(--primary-darkest);
    }

    .saved-note {
        margin: 0;
        padding: 8px 12px;
        white-space: normal;
        font-size: 0.9em;
        background-color: var(--operator-raised, var(--primary-lighter));
        border-left: 3px solid var(--operator-amber, #faa739);
    }

    .scroll span.picked {
        outline: 3px solid var(--operator-amber, var(--accent));
        outline-offset: -3px;
    }

    /* lyric spacing inside scroll */
    .scroll .lyric {
        line-height: 1.5;
        margin: 0.4rem 0; /* gap between lyric blocks */
    }
    .scroll .lyric .break {
        margin-bottom: 0.25rem; /* gap between lines inside a block */
    }

    .layouts {
        display: flex;
        justify-content: space-between;
        background-color: var(--primary-darkest);
        border-radius: 0;
        padding: 4px;
        margin: 0;
        gap: 4px;
        min-height: 60px;
        font-size: 0.95em;
        margin-top: auto;
    }

    .layouts .buttons {
        display: flex;
        gap: 4px;
    }

    .layouts :global(button) {
        border-radius: 8px;
        padding: 0.6em 1em !important;
        min-height: auto !important;
    }

    .empty-hero {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        color: var(--text);
        opacity: 0.95;
        text-align: center;
        padding: 24px;
    }
    .hero-title {
        font-size: clamp(2.2rem, 4vw, 3.4rem);
        margin: 0;
        color: var(--accent);
        letter-spacing: 0.4px;
        font-weight: 700;
    }

    .hero-edition {
        color: var(--accent);
        font-size: 0.72em;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    }
    .hero-actions {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-top: 8px;
    }
    .hero-row {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
        font-weight: 600;
        font-size: 1.05rem;
        cursor: pointer;
        background: transparent;
        border: none;
        padding: 6px 12px;
        border-radius: 10px;
        transition:
            background-color 120ms ease,
            transform 120ms ease;
        align-self: center;
    }
    .hero-row :global(svg) {
        fill: var(--accent);
    }
    .hero-row:hover {
        background: rgb(255 255 255 / 0.06);
        transform: translateY(-1px);
    }
    .hero-row:active {
        transform: translateY(0);
    }
</style>
