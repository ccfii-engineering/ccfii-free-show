<script lang="ts">
    import { onMount, tick } from "svelte"
    import type { RemoteMediaSelection } from "../../../types/remote/control"
    import type { TabsObj } from "../../../types/Tabs"
    import Button from "../../common/components/Button.svelte"
    import Icon from "../../common/components/Icon.svelte"
    import Textarea from "../../common/components/Textarea.svelte"
    import TextInput from "../../common/components/TextInput.svelte"
    import Center from "../../common/components/Center.svelte"
    import Loading from "../../common/components/Loading.svelte"
    import { translate } from "../util/helpers"
    import { send } from "../util/socket"
    import { _set, active, activeTab, createShow, dictionary, isConnected, projectsOpened } from "../util/stores"

    // Phone mode components (always loaded - small footprint)
    import Lyrics from "./pages/Lyrics.svelte"
    import Project from "./pages/Project.svelte"
    import Scripture from "./pages/Scripture.svelte"
    import Show from "./pages/Show.svelte"
    import ShowContent from "./pages/ShowContent.svelte"
    import Shows from "./pages/Shows.svelte"
    import Slide from "./pages/Slide.svelte"
    import MediaLibrary from "./MediaLibrary.svelte"

    // Tablet mode component (lazy-loaded for performance)
    let TabletMode: any = null

    $: tab = $activeTab
    $: if (tab) _set("activeTab", tab)
    $: remoteMediaSelected = !!($active?.data?.remoteMedia as RemoteMediaSelection | undefined)?.item

    let tabs: TabsObj = {}
    $: tabs = {
        project: { name: translate("remote.projects", $dictionary, "Projects"), icon: "project" },
        shows: { name: translate("remote.shows", $dictionary), icon: "search" },
        media: { name: translate("tabs.media", $dictionary), icon: "media" },
        scripture: { name: translate("tabs.scripture", $dictionary), icon: "scripture" },
        slide: { name: translate("remote.control", $dictionary, "Control"), icon: "display_settings" }
        // lyrics: { name: translate("remote.lyrics", $dictionary), icon: "lyrics" },
    }
    $: navTab = remoteMediaSelected && tab === "show" ? "media" : tab === "show" ? "shows" : tab === "lyrics" ? "slide" : tab

    function navigateToTab(id: string) {
        if (id === navTab) {
            if (id === "media" && remoteMediaSelected && tab === "show") {
                tab = "media"
                return
            }
            double({ detail: id })
            return
        }
        tab = id
    }

    async function openSearch() {
        tab = "shows"
        await tick()
        ;(document.querySelector("#showSearch") as HTMLInputElement | null)?.focus()
    }

    // keyboard shortcuts
    function keydown(e: KeyboardEvent) {
        if ((e.target as HTMLElement)?.closest("textarea") || (e.target as HTMLElement)?.closest("input")) return
        if (!$isConnected) return

        if ([" ", "Arrow", "Page"].includes(e.key)) e.preventDefault()

        // WIP keyboard shortcuts same as main app
        if ([" ", "ArrowRight", "PageDown"].includes(e.key)) send("API:next_slide")
        else if (["ArrowLeft", "PageUp"].includes(e.key)) send("API:previous_slide")
        else if (e.key === "Escape") send("API:clear_all")
    }

    // click when focused
    function double(e: any) {
        let id = e.detail
        if (id === "shows" && tab === "show") {
            tab = "shows"
        } else if (id === "shows") {
            ;(document.querySelector("#showSearch") as any)?.focus()
        } else if (id === "project") {
            _set("projectsOpened", !$projectsOpened)
        } else if (id === "scripture") {
            tab = ""
            setTimeout(() => (tab = "scripture"))
        }
    }

    let newShowName = ""
    let newShowText = ""
    let previousCreateShow = false
    $: {
        // Set initial name when dialog opens with a string value
        if ($createShow && typeof $createShow === "string" && !previousCreateShow) {
            newShowName = $createShow
        }
        previousCreateShow = !!$createShow
    }
    function newShow() {
        if (!newShowText) {
            newShowFinish()
            return
        }

        send("API:create_show", { text: newShowText, name: newShowName })
        // WIP open show
        newShowFinish()
    }
    const updateName = (e: any) => (newShowName = e.target?.value)

    function newShowFinish() {
        newShowName = ""
        newShowText = ""
        createShow.set(false)
    }

    let isTablet = false
    let tabletLoading = false

    onMount(() => {
        const media = window.matchMedia("(min-width: 1000px)")
        isTablet = media.matches
        const listener = (e: MediaQueryListEvent) => {
            isTablet = e.matches
            if (e.matches && !TabletMode) loadTabletMode()
        }
        media.addEventListener("change", listener)

        // Load tablet components if needed
        if (isTablet) loadTabletMode()

        return () => media.removeEventListener("change", listener)
    })

    async function loadTabletMode() {
        if (TabletMode || tabletLoading) return
        tabletLoading = true
        const module = await import("./tablet/TabletMode.svelte")
        TabletMode = module.default
        tabletLoading = false
    }
</script>

<svelte:window on:keydown={keydown} />

{#if isTablet}
    <section class="tabletMode">
        {#if TabletMode}
            <svelte:component this={TabletMode} />
        {:else}
            <Center><Loading /></Center>
        {/if}
    </section>
{:else}
    <section class="phoneMode justify">
        <header class="top-bar">
            <button class="top-search" type="button" title={translate("main.search", $dictionary, "Search")} aria-label={translate("main.search", $dictionary, "Search")} on:click={openSearch}>
                <Icon id="search" size={1.25} />
            </button>
        </header>
        <div class="content">
            {#if tab === "shows"}
                <Shows />
            {:else if tab === "media"}
                <MediaLibrary />
            {:else if tab === "scripture"}
                <Scripture />
            {:else if tab === "project"}
                <Project />
            {:else if tab === "show"}
                {#if ($active.type || "show") === "show"}
                    <div class="show-route">
                        <button class="show-back" type="button" on:click={() => (tab = "shows")}>
                            <Icon id="back" size={1.15} />
                            <span>{translate("remote.back_to_shows", $dictionary, "Back to shows")}</span>
                        </button>
                        <Show />
                    </div>
                {:else}
                    <ShowContent />
                {/if}
            {:else if tab === "slide"}
                <Slide />
            {:else if tab === "lyrics"}
                <Lyrics />
            {/if}
        </div>

        <nav class="bottom-tabs" aria-label="Remote navigation">
            {#each Object.entries(tabs) as [id, item]}
                <button class:active={navTab === id} class="nav-button" type="button" title={item.name} aria-current={navTab === id ? "page" : undefined} on:click={() => navigateToTab(id)}>
                    <Icon id={item.icon} size={1.25} />
                    <span>{item.name}</span>
                </button>
            {/each}
        </nav>
    </section>
{/if}

{#if $createShow}
    <div class="fullscreen">
        <div style="display: flex;height: 50px;">
            <Button on:click={() => createShow.set(false)} variant="outlined" style="margin-right: 8px;">
                <Icon id="back" size={2} />
            </Button>
            <TextInput placeholder={translate("main.unnamed", $dictionary)} value={newShowName} on:change={updateName} />
        </div>

        <Textarea style="width: 100%;height: calc(100% - 90px - 6px);" bind:value={newShowText} />

        <div style="display: flex;height: 40px;">
            <Button on:click={newShow} variant="contained" style="width: 100%;" center>
                <Icon id="add" right />
                <p style="font-size: 0.8em;">{translate("new.show", $dictionary)}</p>
            </Button>
        </div>
    </div>
{/if}

<style>
    .content {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        min-height: 0;
    }

    .justify {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }

    .phoneMode {
        display: flex;
    }

    .top-bar {
        display: flex;
        flex: 0 0 auto;
        justify-content: flex-end;
        padding: 4px max(8px, env(safe-area-inset-right)) 0 max(8px, env(safe-area-inset-left));
        background: var(--operator-canvas);
    }

    .top-search {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 8px;
        color: var(--operator-text);
        background: transparent;
        cursor: pointer;
    }

    .top-search:focus-visible {
        outline: 2px solid var(--operator-amber);
        outline-offset: -2px;
    }

    .show-route {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
    }

    .show-back {
        display: flex;
        flex: 0 0 48px;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        border: 0;
        border-bottom: 1px solid var(--operator-border);
        color: var(--operator-text);
        background: var(--operator-surface);
        font: inherit;
        text-align: left;
    }

    .bottom-tabs {
        display: flex;
        position: relative;
        z-index: 3;
        gap: 4px;
        padding: 4px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
        background: var(--operator-canvas);
    }

    .nav-button {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 56px;
        flex-direction: column;
        flex: 1 1 0;
        gap: 2px;
        padding: 6px 2px;
        border: 0;
        border-radius: 8px;
        color: var(--operator-muted);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }

    .nav-button.active {
        color: var(--operator-amber);
        outline: 1px solid var(--operator-border);
    }

    .nav-button :global(svg) {
        width: 20px;
        height: 20px;
        min-width: 20px;
    }

    .nav-button span {
        display: block;
        max-width: 100%;
        overflow: hidden;
        font-size: 11px;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .tabletMode {
        display: flex;
        height: 100%;
        justify-content: space-between;
    }

    .fullscreen {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;

        background-color: var(--primary);
        z-index: 99;
        display: flex;
        flex-direction: column;
        padding: 16px;
        gap: 16px;
    }
</style>
