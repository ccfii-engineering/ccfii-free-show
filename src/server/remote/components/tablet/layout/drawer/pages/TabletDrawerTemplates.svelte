<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { describeTemplateClickTarget, resolveTemplateInUse, type TemplateSource } from "../../../../../../../common/templates/templateInUse"
    import type { RemoteTemplateResult } from "../../../../../../../types/remote/protocol"
    import type { Template } from "../../../../../../../types/Show"
    import Icon from "../../../../../../common/components/Icon.svelte"
    import Center from "../../../../../../common/components/Center.svelte"
    import { translate, translateWith } from "../../../../../util/helpers"
    import { onResponse, send } from "../../../../../util/socket"
    import { activeShow, activeTemplateCategory, categories, dictionary, isConnected, outputStyleTemplate, selectedSlides, templateCategories, templateScope, templates } from "../../../../../util/stores"
    import { GetLayout } from "../../../../../util/output"
    import MaterialButton from "../../../../MaterialButton.svelte"
    import Zoomed from "../../../../show/Zoomed.svelte"
    import Textbox from "../../../../show/Textbox.svelte"

    export let searchValue: string = ""

    // Resolution for templates preview
    let resolution = { width: 1920, height: 1080 }

    // Get current category
    $: activeCategory = $activeTemplateCategory || "all"

    // Convert templates object to array with IDs
    $: templatesList = Object.entries($templates || {}).map(([id, template]) => ({
        id,
        ...(template as Template)
    }))

    // Filter templates by category
    $: categoryFilteredTemplates = templatesList.filter((template) => {
        if (activeCategory === "all") {
            // Exclude archived categories in "all" view
            return !$templateCategories[template.category || ""]?.isArchive
        }
        if (activeCategory === "unlabeled") {
            return template.category === null || !$templateCategories[template.category]
        }
        return template.category === activeCategory
    })

    // Filter templates by search
    $: filteredTemplates = categoryFilteredTemplates.filter((template) => {
        if (!searchValue) return true
        return (template.name || "").toLowerCase().includes(searchValue.toLowerCase())
    })

    // Sort templates by name
    $: sortedTemplates = [...filteredTemplates].sort((a, b) => (a.name || "").localeCompare(b.name || ""))

    // what the show uses today, and what overrides it
    $: showId = $activeShow?.id || ""
    $: categoryId = $activeShow?.category || ""
    $: category = $categories[categoryId]
    $: categoryTemplateId = category?.template || ""
    $: categoryTemplateName = $templates[categoryTemplateId]?.name || ""
    $: categoryName = category?.default ? translate(category?.name || "", $dictionary, category?.name) : category?.name || ""
    $: templateInUse = resolveTemplateInUse({
        showTemplateId: $activeShow?.settings?.template,
        categoryTemplateId,
        outputStyleTemplateId: $outputStyleTemplate,
        isKnownTemplate: (id) => !!$templates[id]
    })
    $: inUseId = $activeShow ? templateInUse.templateId : null
    $: inUseName = (inUseId && $templates[inUseId]?.name) || ""
    $: inUseSource = templateInUse.source ? translate("template_use.source_" + (templateInUse.source as TemplateSource).replace("-", "_"), $dictionary) : ""
    $: styleOverrideName = $outputStyleTemplate ? $templates[$outputStyleTemplate]?.name || "" : ""

    // apply scope: "Selected slides" turns the show grid into a picker
    $: totalSlideCount = $activeShow ? GetLayout($activeShow, $activeShow.settings?.activeLayout || "").length : 0
    $: selectedCount = $selectedSlides.length
    $: clickTarget = describeTemplateClickTarget({ selectedSlideCount: $templateScope === "slides" ? selectedCount : 0, totalSlideCount })
    $: picking = $templateScope === "slides"
    $: targetText = !$activeShow ? translate("template_use.no_show_hint", $dictionary) : picking && !selectedCount ? translate("template_use.pick_slides_hint", $dictionary) : clickTarget.scope === "slides" ? translateWith(clickTarget.count === 1 ? "template_use.one_selected_slide" : "template_use.n_selected_slides", [clickTarget.count], $dictionary) : translate("template_use.whole_show", $dictionary)
    $: categoryBlocksShow = !!categoryTemplateId && !!$activeShow && clickTarget.scope === "show" && !(picking && !selectedCount)
    $: canApply = $isConnected && !!$activeShow && !(picking && !selectedCount)

    // result of the last tap, answered by the main app
    let result: RemoteTemplateResult | null = null
    let resultTimeout: ReturnType<typeof setTimeout> | null = null
    function showResult(next: RemoteTemplateResult | null) {
        result = next
        if (resultTimeout) clearTimeout(resultTimeout)
        resultTimeout = next ? setTimeout(() => (result = null), 8000) : null
    }
    $: resultText = !result ? "" : result.status === "applied" ? (result.scope === "slides" ? translateWith(result.count === 1 ? "template_use.applied_one_slide" : "template_use.applied_slides", [result.count], $dictionary) : translate("template_use.applied_show", $dictionary)) : translate("template_use.blocked_" + result.reason, $dictionary)
    // a message about another show or scope is stale
    $: if ($templateScope || showId) showResult(null)

    const stopListening = onResponse("API:set_template", (data) => showResult(data))
    onDestroy(() => {
        stopListening()
        if (resultTimeout) clearTimeout(resultTimeout)
        // leaving the drawer ends slide picking, so a tap on a slide plays it again
        templateScope.set("show")
    })

    function setScope(scope: "show" | "slides") {
        templateScope.set(scope)
    }

    // Handle template click: the main app applies it to the show open here and replies applied or blocked
    function clickTemplate(templateId: string) {
        if (!canApply) return
        showResult(null)

        const scope = clickTarget.scope
        send("API:set_template", { id: templateId, showId, scope, ...(scope === "slides" ? { slides: [...$selectedSlides] } : {}) })
    }

    let isLoading = true
    onMount(() => {
        send("GET_TEMPLATES")

        // Fallback to stop loading if no data comes in
        setTimeout(() => {
            isLoading = false
        }, 1000)
    })

    $: if (templatesList.length > 0) isLoading = false
</script>

<div class="scroll-container">
    <div class="column">
        <div class="scope" data-testid="template-scope">
            <div class="scopeRow">
                <span class="scopeLabel">{translate("template_use.apply_to", $dictionary)}</span>
                <div class="scopeSwitch" role="group" aria-label={translate("template_use.apply_to", $dictionary)}>
                    <MaterialButton variant={$templateScope === "show" ? "contained" : "outlined"} isActive={$templateScope === "show"} on:click={() => setScope("show")}>
                        {translate("template_use.whole_show", $dictionary)}
                    </MaterialButton>
                    <MaterialButton variant={$templateScope === "slides" ? "contained" : "outlined"} isActive={$templateScope === "slides"} disabled={!$activeShow} on:click={() => setScope("slides")}>
                        {translate("template_use.selected_slides", $dictionary)}
                    </MaterialButton>
                </div>
                <span class="target" data-testid="template-target">{targetText}</span>
                {#if inUseName}
                    <span class="inUseLine" data-testid="template-in-use-line">{translateWith("template_use.in_use", [inUseName], $dictionary)}{inUseSource ? ` (${inUseSource})` : ""}</span>
                {/if}
            </div>

            {#if !$isConnected}
                <div class="notice" role="status" data-testid="template-offline">{translate("template_use.offline", $dictionary)}</div>
            {/if}
            {#if categoryBlocksShow}
                <div class="notice warning" data-testid="template-category-warning">
                    <Icon id="warning" size={1} white />
                    <span>{translateWith("template_use.warn_category", [categoryName, categoryTemplateName], $dictionary)}</span>
                </div>
            {/if}
            {#if styleOverrideName}
                <div class="notice warning" data-testid="template-style-warning">
                    <Icon id="warning" size={1} white />
                    <span>{translateWith("template_use.warn_style", [styleOverrideName], $dictionary)}</span>
                </div>
            {/if}
            {#if result}
                <div class="notice {result.status}" role="status" data-testid="template-result">{resultText}</div>
            {/if}
        </div>

        {#if templatesList.length}
            {#if sortedTemplates.length}
                <div class="grid">
                    {#each sortedTemplates as template (template.id)}
                        <div class="template-card" class:inUse={template.id === inUseId}>
                            <MaterialButton style="width: 100%; height: 100%; padding: 0; flex-direction: column; border-radius: 8px; overflow: hidden;" disabled={!canApply} on:click={() => clickTemplate(template.id)} title={template.name || translate("main.unnamed", $dictionary)}>
                                <div class="preview">
                                    <Zoomed center {resolution} background={template.items?.length ? template.settings?.backgroundColor || "var(--primary);" : template.color || "var(--primary);"} checkered={!!template.items?.length && !template.settings?.backgroundColor}>
                                        {#each template.items || [] as item}
                                            <Textbox {item} />
                                        {/each}
                                    </Zoomed>
                                </div>

                                <div class="label">
                                    {#if template.isDefault}
                                        <Icon id="protected" style="opacity: 0.6; margin-inline-start: 3px; position: absolute; left: 0;" size={0.6} white />
                                    {/if}
                                    <span class="name">{template.name || translate("main.unnamed", $dictionary)}</span>
                                </div>
                                {#if template.id === inUseId}
                                    <span class="badge inUseBadge" data-testid="template-in-use">{translate("template_use.in_use_badge", $dictionary)}</span>
                                {/if}
                                {#if categoryBlocksShow}
                                    <span class="badge blocked" aria-hidden="true"><Icon id="warning" size={0.7} white /></span>
                                {/if}
                            </MaterialButton>
                        </div>
                    {/each}
                </div>
            {:else}
                <Center faded>{translate("empty.search", $dictionary)}</Center>
            {/if}
        {:else if isLoading}
            <Center faded>{translate("remote.loading", $dictionary)}</Center>
        {:else}
            <Center faded>{translate("empty.general", $dictionary)}</Center>
        {/if}
    </div>
</div>

<style>
    .scroll-container {
        overflow-y: auto;
        flex: 1;
        height: 100%;
    }

    .column {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--primary-darkest);
        padding-bottom: 60px;
    }

    .scope {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background-color: var(--operator-surface, var(--primary));
        border-bottom: 1px solid var(--operator-border, var(--primary-lighter));
    }
    .scopeRow {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 12px;
    }
    .scopeLabel {
        color: var(--operator-muted, inherit);
        font-size: 0.9em;
    }
    .scopeSwitch {
        display: flex;
        border: 1px solid var(--operator-border, var(--primary-lighter));
        border-radius: 8px;
        overflow: hidden;
    }
    .scopeSwitch :global(button) {
        min-height: 44px;
        padding: 0 14px;
        border-radius: 0;
        font-size: 0.95em;
    }
    .scopeSwitch :global(button.contained) {
        background: var(--operator-amber, var(--secondary)) !important;
        color: var(--operator-on-amber, var(--secondary-text)) !important;
        font-weight: 600;
    }
    .target {
        font-size: 0.95em;
        font-weight: 600;
    }
    .inUseLine {
        color: var(--operator-muted, inherit);
        font-size: 0.9em;
    }
    .notice {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 10px;
        font-size: 0.9em;
        border-radius: 8px;
        background-color: var(--operator-raised, var(--primary-lighter));
    }
    .notice.warning {
        background-color: rgb(250 167 57 / 0.15);
        border-left: 3px solid var(--operator-amber, #faa739);
    }
    .notice.blocked {
        background-color: rgb(155 36 36 / 0.3);
        border-left: 3px solid var(--operator-crimson-strong, #9b2424);
    }
    .notice.applied {
        border-left: 3px solid var(--operator-amber, #faa739);
    }

    .template-card.inUse::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        border: 2px solid var(--operator-amber, var(--secondary));
        border-radius: 8px;
        pointer-events: none;
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
        pointer-events: none;
    }
    .badge.inUseBadge {
        left: 4px;
        background-color: var(--operator-amber, var(--secondary));
        color: var(--operator-on-amber, var(--secondary-text));
    }
    .badge.blocked {
        right: 4px;
        background-color: #b36b00;
    }

    .grid {
        display: flex;
        flex-wrap: wrap;
        padding: 8px;
        gap: 8px;
    }

    .template-card {
        width: calc(20% - 6.4px);
        min-width: 120px;
        /* aspect-ratio: 16/9; */
        border-radius: 8px;
        overflow: hidden;
        position: relative;
        background-color: var(--primary);
        transition: outline 0.15s ease;
        display: flex;
        flex-direction: column;
    }

    .template-card :global(button) {
        background-color: transparent !important;
    }

    .template-card:hover :global(button) {
        background-color: rgb(255 255 255 / 0.05) !important;
    }

    .preview {
        position: relative;
        width: 100%;
        /* flex: 1; */
        aspect-ratio: 16/9;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }

    .label {
        position: relative;
        display: flex;
        align-items: center;
        background-color: var(--primary-darkest);

        font-size: 0.8em;
        /* font-weight: bold; */

        height: 25px;
        flex: 1;

        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;

        width: 100%;
        text-align: center;
        padding: 4px 5px;
        padding-bottom: 3px;
    }

    .name {
        width: 100%;
        margin: 0 5px;
        text-align: center;
        overflow-x: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Responsive grid */
    @media (max-width: 600px) {
        .template-card {
            width: calc(33.333% - 6px);
        }
    }

    @media (min-width: 900px) {
        .template-card {
            width: calc(16.666% - 6.7px);
        }
    }

    @media (min-width: 1200px) {
        .template-card {
            width: calc(12.5% - 7px);
        }
    }
</style>
