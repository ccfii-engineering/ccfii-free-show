<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte"
    import type { DropdownOptions } from "../../../types/Input"
    import { collectFontsUsedInShow } from "../../../common/fonts/fontsUsedInShow"
    import { addRecentFont, normalizeFontName, orderFontsForShow } from "../../../common/fonts/orderFontsForShow"
    import { selectCachedShow } from "../../showsCacheState/showsCache.svelte"
    import { recentFonts } from "../../stores"
    import { getFontName, getFontStyleList, getSystemFontsList } from "../helpers/fonts"
    import MaterialDropdown from "./MaterialDropdown.svelte"
    import InputRow from "../input/InputRow.svelte"

    export let label: string
    export let value: string
    export let fontStyleValue = ""
    export let enableFontStyles = false
    export let allowEmpty = false
    // fonts used in this show are listed first
    export let showId = ""

    let systemFontsList: DropdownOptions = []
    let fontsStylesList: DropdownOptions = []

    onMount(async () => {
        systemFontsList = await getSystemFontsList()
    })

    let defaultFontStyleValue = ""
    $: if (value && enableFontStyles) updateStyles()
    function updateStyles() {
        const { fontStyles, defaultValue } = getFontStyleList(value)
        fontsStylesList = fontStyles
        defaultFontStyleValue = defaultValue
    }

    $: showStore = selectCachedShow(showId || "")
    $: usedInShow = showId ? collectFontsUsedInShow($showStore) : []
    $: fontOptions = groupFontOptions(systemFontsList, usedInShow, $recentFonts)

    function groupFontOptions(systemOptions: DropdownOptions, used: string[], recent: string[]): DropdownOptions {
        if (!systemOptions.length) return systemOptions

        const ordered = orderFontsForShow({ systemFonts: systemOptions.map((a) => a.label), usedInShow: used, recent })
        // headings are only useful when there is something to separate
        if (!ordered.used.length && !ordered.recent.length) return systemOptions

        const byName = new Map(systemOptions.map((a) => [normalizeFontName(a.label).toLowerCase(), a]))
        const toOption = (name: string) => byName.get(name.toLowerCase()) || { label: name, value: getFontName(name), style: `font-family: ${getFontName(name)};` }
        const group = (key: string, label: string, names: string[]): DropdownOptions => (names.length ? [{ label, value: "__heading_" + key, heading: true }, ...names.map(toOption)] : [])

        return [...group("used", "edit.font_group_used", ordered.used), ...group("recent", "edit.font_group_recent", ordered.recent), ...group("all", "edit.font_group_all", ordered.all)]
    }

    const dispatch = createEventDispatcher()
    function change(e) {
        let value = e.detail
        if (value) recentFonts.update((a) => addRecentFont(a, value))
        fontStyleValue = ""
        dispatch("change", value)
    }
    function styleChange(e) {
        fontStyleValue = e.detail
        dispatch("fontStyle", fontStyleValue)
    }

    $: fontStylesVisible = enableFontStyles && value !== "CMGSans"

    $: quotedValue = getFontName(value)
</script>

<InputRow style={$$props.style || ""}>
    <MaterialDropdown {label} options={fontOptions} value={quotedValue} style={fontStylesVisible ? "max-width: 85%;" : ""} on:change={change} {allowEmpty} />
    {#if fontStylesVisible}
        <MaterialDropdown label="settings.font_style" disabled={fontsStylesList.length < 2} options={fontsStylesList} value={fontStyleValue || defaultFontStyleValue} on:change={styleChange} onlyArrow />
    {/if}
</InputRow>
