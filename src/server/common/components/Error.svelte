<script lang="ts">
    export let errors: string[] = []
</script>

{#if errors.length}
    <div class="error">
        {#each errors as error}
            <span>{error}</span>
        {/each}
    </div>
{/if}

<style>
    .error {
        color: var(--text);
        position: absolute;
        margin: 10px;
        padding: 10px;
        width: calc(100% - 20px);
        text-align: center;
        background-color: var(--secondary);
        border: 1px solid var(--accent);
        display: flex;
        flex-direction: column;
    }
</style>
