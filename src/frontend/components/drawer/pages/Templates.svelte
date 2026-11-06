<script lang="ts">
    import { onMount } from "svelte"
    import { describeTemplateClickTarget, getTemplateApplyBlock, resolveTemplateInUse, type ApplyScope } from "../../../../common/templates/templateInUse"
    import type { Template } from "../../../../types/Show"
    import { selectCachedShow } from "../../../showsCacheState/showsCache.svelte"
    import { activeEdit, activePage, activePopup, activeShow, alertMessage, categories, labelsDisabled, mediaOptions, outputs, selected, special, styles, templateApplied, templateCategories, templates } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import { getAccess } from "../../../utils/profile"
    import { clone, keysToID, sortByName } from "../../helpers/array"
    import { history } from "../../helpers/history"
    import { getFirstActiveOutput, getResolution } from "../../helpers/output"
    import { deselect } from "../../helpers/select"
    import { getLayoutRef } from "../../helpers/show"
    import { _show, getSlideSettings } from "../../helpers/shows"
    import T from "../../helpers/T.svelte"
    import FloatingInputs from "../../input/FloatingInputs.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import Icon from "../../helpers/Icon.svelte"
    import Loader from "../../main/Loader.svelte"
    import Actions from "../../slide/Actions.svelte"
    import Center from "../../system/Center.svelte"
    import DropArea from "../../system/DropArea.svelte"
    import SelectElem from "../../system/SelectElem.svelte"
    import Card from "../Card.svelte"
    import TemplateSlide from "./TemplateSlide.svelte"

    export let active: string | null
    export let searchValue = ""

    const profile = getAccess("templates")
    $: readOnly = profile.global === "read" || profile[active || ""] === "read"

    $: resolution = getResolution(null, { outputs: $outputs, styles: $styles }) // $templates[active || ""]?.settings?.resolution
    let filteredTemplates: (Template & { id: string })[] = []

    $: isShowActive = !!($activeShow && ($activeShow?.type || "show") === "show")
    $: activeShowId = isShowActive ? $activeShow?.id || "" : ""
    $: myShow = selectCachedShow(activeShowId)
    $: currentShow = $myShow

    // what the show uses today, and what overrides it
    $: categoryId = currentShow?.category || ""
    $: categoryTemplateId = $categories[categoryId]?.template || ""
    $: categoryTemplateName = $templates[categoryTemplateId]?.name || ""
    $: categoryName = $categories[categoryId]?.default ? translateText($categories[categoryId]?.name || "") : $categories[categoryId]?.name || ""
    $: outputStyleId = getFirstActiveOutput($outputs)?.style || ""
    $: outputStyleTemplateId = $special.styleTemplatePreview !== false ? $styles[outputStyleId]?.template || "" : ""
    $: templateInUse = resolveTemplateInUse({
        showTemplateId: currentShow?.settings?.template,
        categoryTemplateId,
        outputStyleTemplateId,
        isKnownTemplate: (id) => !!$templates[id]
    })
    $: activeTemplate = isShowActive ? templateInUse.templateId : null

    // apply scope
    $: selectedSlideCount = $selected.id === "slide" ? $selected.data.length : 0
    $: totalSlideCount = currentShow ? getLayoutRef("active", currentShow).length : 0
    let scope: ApplyScope = $selected.id === "slide" && $selected.data.length ? "slides" : "show" // keep today's behaviour if slides are selected when the drawer opens
    $: if (selectedSlideCount === 0 && scope === "slides") scope = "show"
    $: clickTarget = describeTemplateClickTarget({ selectedSlideCount: scope === "slides" ? selectedSlideCount : 0, totalSlideCount })
    $: targetText = clickTarget.scope === "slides" ? translateText(clickTarget.count === 1 ? "template_use.one_selected_slide" : "template_use.n_selected_slides", null, [String(clickTarget.count)]) : translateText(clickTarget.labelKey)

    $: profileAccess = getAccess("shows")
    $: showReadOnly = profileAccess.global === "read" || profileAccess[categoryId] === "read"
    $: applyBlock = getTemplateApplyBlock({ scope: clickTarget.scope === "slides" || scope === "slides" ? "slides" : "show", showLocked: !!currentShow?.locked, readOnly: showReadOnly, categoryTemplateId })
    $: categoryBlocksShow = !!categoryTemplateId && scope === "show"
    $: styleOverrideName = outputStyleTemplateId && templateInUse.outputStyleOverride ? $templates[templateInUse.outputStyleOverride]?.name || "" : ""

    let fullFilteredTemplates: (Template & { id: string })[] = []
    $: if ($templates || active || $templateCategories) updateTemplates()

    function updateTemplates() {
        filteredTemplates = sortByName(keysToID(clone($templates)).filter((s) => (active === "all" && !$templateCategories[s?.category || ""]?.isArchive) || active === s.category || (active === "unlabeled" && (s.category === null || !$templateCategories[s.category])))).filter((a) => a?.settings?.mode !== "text")

        filterSearch()
    }

    // search
    $: if (searchValue !== undefined) filterSearch()
    const filter = (s: string) => s.toLowerCase().replace(/[.,\/#!?$%\^&\*;:{}=\-_`~()]/g, "")
    function filterSearch() {
        fullFilteredTemplates = clone(filteredTemplates)
        if (searchValue.length > 1) fullFilteredTemplates = fullFilteredTemplates.filter((a) => filter(a.name).includes(filter(searchValue)))
    }

    let nextScrollTimeout: NodeJS.Timeout | null = null
    function wheel(e: any) {
        if (!e.ctrlKey && !e.metaKey) return
        if (nextScrollTimeout) return

        mediaOptions.set({ ...$mediaOptions, columns: Math.max(2, Math.min(10, $mediaOptions.columns + (e.deltaY < 0 ? -100 : 100) / 100)) })

        // don't start timeout if scrolling with mouse
        if (e.deltaY >= 100 || e.deltaY <= -100) return
        nextScrollTimeout = setTimeout(() => {
            nextScrollTimeout = null
        }, 500)
    }

    // open drawer tab instantly before content has loaded
    let preloader = true
    onMount(() => setTimeout(() => (preloader = false), 20))

    $: templateWithNonExistentCategory = active === "unlabeled" && filteredTemplates.some((s) => s.category)
    function createNonExistentCategories() {
        const nonexistentCategories = [...new Set(filteredTemplates.map((s) => s.category))].filter((c) => c && !$templateCategories[c]) as string[]

        templateCategories.update((a) => {
            nonexistentCategories.forEach((id) => {
                if (a[id]) return
                a[id] = { name: translateText("main.unnamed") }
            })
            return a
        })
    }

    function templateClick(e: MouseEvent | null = null, templateId: string) {
        if (e?.target?.closest?.(".edit") || e?.target?.closest?.(".icons")) return
        if (!$activeShow || !isShowActive || e?.ctrlKey || e?.metaKey) return

        if (applyBlock === "show_locked") {
            alertMessage.set("show.locked")
            activePopup.set("alert")
            return
        }
        if (applyBlock === "read_only") {
            alertMessage.set("profile.locked")
            activePopup.set("alert")
            return
        }

        // selected slides
        if (scope === "slides" && selectedSlideCount) {
            let ref = getLayoutRef()
            $selected.data.forEach(({ index, showId }) => {
                let slideId = ref[index]?.id

                // check if locked
                let groupSlide = _show(showId || "active")
                    .slides([ref[index]?.parent?.id || ref[index]?.id])
                    .get()[0]
                if (groupSlide?.locked) return

                let slideSettings = getSlideSettings(slideId, showId || "active")
                let oldData = { style: clone(slideSettings) }
                let newData = { style: { ...slideSettings, template: templateId } }

                // WIP apply to all slides at once...
                history({
                    id: "slideStyle",
                    oldData,
                    newData,
                    location: { page: "edit", show: $activeShow, slide: slideId }
                })
            })

            deselect()
            // WIP refresh slides (apply template)
            return
        }

        // a category template blocks whole-show applies (the cards warn about it before the click)
        if (applyBlock === "category_template") return

        templateApplied.set(true)
        setTimeout(() => templateApplied.set(false), 500)

        history({ id: "TEMPLATE", newData: { id: templateId, data: { createItems: true, shiftItems: e?.shiftKey } }, location: { page: "none", override: "show#" + $activeShow.id } })
    }

    function keydown(e: KeyboardEvent) {
        if (e.key === "Enter" && searchValue.length > 1 && e.target?.closest(".search")) {
            let template = fullFilteredTemplates[0]
            if (!template) return

            // play
            if (e.ctrlKey || e.metaKey) {
                templateClick(null, template.id)
                return
            }

            // add to project (no need)
        }
    }
</script>

<svelte:window on:keydown={keydown} />

<div style="position: relative;height: 100%;overflow-y: auto;" class="context #drawer_templates" on:wheel={wheel}>
    {#if isShowActive}
        <div class="scope templateScope">
            <div class="scopeRow">
                {#if !$labelsDisabled}<span class="scopeLabel"><T id="template_use.apply_to" /></span>{/if}
                <div class="scopeSwitch" role="group" aria-label={translateText("template_use.apply_to")}>
                    <MaterialButton variant={scope === "show" ? "contained" : "outlined"} isActive={scope === "show"} on:click={() => (scope = "show")}>
                        <T id="template_use.whole_show" />
                    </MaterialButton>
                    <MaterialButton variant={scope === "slides" ? "contained" : "outlined"} isActive={scope === "slides"} disabled={!selectedSlideCount} title={selectedSlideCount ? "" : "template_use.select_slides_hint"} on:click={() => (scope = "slides")}>
                        <T id="template_use.selected_slides" />
                    </MaterialButton>
                </div>
                <span class="target" data-testid="template-target">{targetText}</span>
            </div>

            {#if categoryBlocksShow}
                <div class="warning" data-testid="template-category-warning">
                    <Icon id="warning" size={1} white />
                    <span>{translateText("template_use.warn_category", null, [categoryName, categoryTemplateName])}</span>
                </div>
            {/if}
            {#if styleOverrideName}
                <div class="warning" data-testid="template-style-warning">
                    <Icon id="warning" size={1} white />
                    <span>{translateText("template_use.warn_style", null, [styleOverrideName])}</span>
                </div>
            {/if}
        </div>
    {/if}

    <DropArea id="templates">
        <!-- WIP lazy loading with skeleton instead -->
        {#if preloader && fullFilteredTemplates.length > 10}
            <Center>
                <Loader />
            </Center>
        {:else if fullFilteredTemplates.length}
            <div class="grid" style="--width: {100 / $mediaOptions.columns}%;">
                {#each fullFilteredTemplates as template}
                    {@const isReadOnly = readOnly || profile[template.category || ""] === "read"}

                    <SelectElem id="template" data={template.id} class="context #template_card{template.isDefault && !isReadOnly ? '_default' : ''}{isReadOnly ? '_readonly' : ''}" draggable fill>
                        <Card width={100} preview={$activePage === "edit" && $activeEdit.type === "template" && $activeEdit.id === template.id} active={template.id === activeTemplate} label={template.name} renameId="template_{template.id}" icon={template.isDefault ? "protected" : null} color={template.color} {resolution} showApplyOnHover={isShowActive} on:click={(e) => templateClick(e, template.id)}>
                            <!-- icons -->
                            {#if template.settings?.actions?.length}
                                <Actions columns={$mediaOptions.columns} templateId={template.id} actions={{ slideActions: template.settings?.actions }} />
                            {/if}

                            <TemplateSlide templateId={template.id} {template} preview />

                            {#if isShowActive && template.id === activeTemplate}
                                <span class="badge inUse" data-testid="template-in-use"><T id="template_use.in_use_badge" /></span>
                            {/if}
                            {#if isShowActive && categoryBlocksShow}
                                <span class="badge blocked" data-title={translateText("template_use.warn_category", null, [categoryName, categoryTemplateName])}><Icon id="warning" size={0.8} white /></span>
                            {/if}
                        </Card>
                    </SelectElem>
                {/each}
            </div>
        {:else}
            <Center size={1.2} faded>
                {#if filteredTemplates.length}
                    <T id="empty.search" />
                {:else}
                    <T id="empty.general" />
                {/if}
            </Center>
        {/if}
    </DropArea>
</div>

{#if templateWithNonExistentCategory}
    <FloatingInputs side="left" onlyOne>
        <MaterialButton icon="autofill" on:click={createNonExistentCategories}>
            <T id="category.create_nonexistent" />
        </MaterialButton>
    </FloatingInputs>
{/if}

<FloatingInputs onlyOne>
    <MaterialButton disabled={readOnly} icon="add" title="new.template" on:click={() => history({ id: "UPDATE", location: { page: "drawer", id: "template" } })}>
        {#if !$labelsDisabled}<T id="new.template" />{/if}
    </MaterialButton>
</FloatingInputs>

<style>
    .scope {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        background-color: var(--primary-darkest);
        border-bottom: 1px solid var(--primary-lighter);
    }
    .scopeRow {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
    }
    .scopeLabel {
        opacity: 0.7;
        font-size: 0.9em;
    }
    .scopeSwitch {
        display: flex;
        border: 1px solid var(--primary-lighter);
        border-radius: 4px;
        overflow: hidden;
    }
    .target {
        font-size: 0.9em;
        opacity: 0.8;
    }
    .warning {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 4px 8px;
        font-size: 0.85em;
        background-color: rgb(255 170 0 / 0.15);
        border-left: 3px solid #ffaa00;
        border-radius: 2px;
    }
    .badge {
        position: absolute;
        top: 4px;
        z-index: 2;
        display: flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 0.75em;
        font-weight: bold;
        pointer-events: auto;
    }
    .badge.inUse {
        left: 4px;
        background-color: var(--secondary);
        color: var(--secondary-text);
    }
    .badge.blocked {
        right: 4px;
        background-color: #b36b00;
    }

    .grid {
        display: flex;
        flex-wrap: wrap;
        flex: 1;
        padding: 5px;
        place-content: flex-start;

        padding-bottom: 60px;
    }

    .grid :global(.selectElem) {
        width: var(--width);
        outline-offset: -3px;
    }
    .grid :global(.isSelected) {
        border-radius: 0 !important;
    }
</style>
