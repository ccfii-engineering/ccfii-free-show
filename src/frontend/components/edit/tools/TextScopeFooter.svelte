<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import { translateText } from "../../../utils/language"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"

    /** Slides with their own text style. */
    export let count = 0

    const dispatch = createEventDispatcher()

    $: text = count === 0 ? translateText("text_scope.own_style_none") : count === 1 ? translateText("text_scope.own_style_one") : translateText("text_scope.own_style", null, [String(count)])
</script>

<div class="footer" data-testid="text-scope-footer">
    <span class="count" data-testid="text-scope-own-count">{text}</span>
    <MaterialButton variant="outlined" disabled={!count} on:click={() => dispatch("reset")}><T id="text_scope.reset" /></MaterialButton>
</div>

<style>
    .footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 4px 12px;
        padding: 6px 10px;
        font-size: 0.9em;
        border-top: 1px solid var(--primary-lighter);
    }
    .count {
        opacity: 0.85;
    }
</style>
