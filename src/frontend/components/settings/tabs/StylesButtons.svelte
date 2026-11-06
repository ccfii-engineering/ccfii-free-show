<script lang="ts">
    import { updateOutputs } from "../../../outputState/outputs.svelte"
    import { activeStyle, outputs } from "../../../stores"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"

    $: styleId = $activeStyle || Object.keys($outputs)[0] || ""
    $: normalOutputs = Object.values($outputs).filter((a) => a.enabled && !a.stageOutput)

    function useStyle() {
        updateOutputs((a) => {
            Object.keys(a).forEach((outputId) => {
                let output = a[outputId]
                if (output.stageOutput || !output.enabled) return

                output.style = styleId
            })
            return a
        })
    }
</script>

{#if styleId && normalOutputs.length === 1 && normalOutputs[0].style !== styleId}
    <MaterialButton variant="outlined" style="padding: 6px 10px;font-size: 0.85em;" icon="check" on:click={useStyle} white>
        <T id="settings.active_style" />
    </MaterialButton>
{/if}
