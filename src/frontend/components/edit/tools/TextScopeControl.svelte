<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import { labelsDisabled } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import { getScopeDescriptionKey, TEXT_SCOPES, type TextScope } from "../scripts/textScope"

    export let scope: TextScope = "slide"
    /** Name of the template in use for the edited slide, empty if none. */
    export let templateName = ""
    /** Show the post-change offer. */
    export let offer = false
    export let offerHasTemplate = false
    export let offerHasOtherSlides = true

    const dispatch = createEventDispatcher()

    $: hasTemplate = !!templateName
    $: descriptionKey = getScopeDescriptionKey(scope, hasTemplate)
    $: description = translateText(descriptionKey, null, [templateName])
</script>

<div class="textScope" data-testid="text-scope">
    <div class="row">
        {#if !$labelsDisabled}<span class="label"><T id="text_scope.apply_to" /></span>{/if}
        <div class="switch" role="group" aria-label={translateText("text_scope.apply_to")}>
            {#each TEXT_SCOPES as value}
                <MaterialButton variant={scope === value ? "contained" : "outlined"} isActive={scope === value} disabled={value === "template" && !hasTemplate} on:click={() => dispatch("scope", value)}>
                    <T id="text_scope.{value}" />
                </MaterialButton>
            {/each}
        </div>
    </div>
    <span class="description" data-testid="text-scope-description">{description}</span>

    {#if offer && scope === "slide"}
        <div class="offer" data-testid="text-scope-offer">
            <span><T id="text_scope.offer" /></span>
            <div class="buttons">
                {#if offerHasOtherSlides}
                    <MaterialButton variant="outlined" on:click={() => dispatch("offer", "all")}><T id="text_scope.offer_all" /></MaterialButton>
                {/if}
                {#if offerHasTemplate}
                    <MaterialButton variant="outlined" on:click={() => dispatch("offer", "template")}><T id="text_scope.offer_template" /></MaterialButton>
                {/if}
                <MaterialButton variant="outlined" on:click={() => dispatch("offer", "keep")}><T id="text_scope.offer_keep" /></MaterialButton>
            </div>
        </div>
    {/if}
</div>

<style>
    .textScope {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 10px;
        background-color: var(--primary-darkest);
        border-bottom: 1px solid var(--primary-lighter);
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
    }
    .label {
        opacity: 0.7;
        font-size: 0.9em;
    }
    .switch {
        display: flex;
        border: 1px solid var(--primary-lighter);
        border-radius: 4px;
        overflow: hidden;
    }
    .description {
        font-size: 0.85em;
        opacity: 0.8;
    }
    .offer {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        font-size: 0.9em;
        background-color: rgb(255 255 255 / 0.06);
        border-left: 3px solid var(--secondary);
        border-radius: 2px;
    }
    .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
</style>
