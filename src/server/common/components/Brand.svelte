<script lang="ts">
    export let role: string
    export let compact: boolean = false

    const ccfiiLogo = "/ccfii-logo.png"
</script>

<div class="brand-lockup" class:compact role="group" aria-label={`FreeShow ${role}, CCFII Edition`}>
    <img class="brand-logo" src={ccfiiLogo} alt="CCFII emblem" draggable="false" />
    <div class="brand-copy">
        <span class="brand-name">FreeShow</span>
        <span class="brand-edition">CCFII Edition</span>
        <span class="brand-role">{role}</span>
    </div>
</div>

<style>
    .brand-lockup {
        display: inline-flex;
        align-items: center;
        gap: 12px;
    }

    .brand-logo {
        display: block;
        width: 50px;
        height: 50px;
        object-fit: contain;
        flex-shrink: 0;
    }

    .brand-copy {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1.1;
    }

    .brand-name {
        color: var(--text);
        font-size: 1.3em;
        font-weight: 700;
        letter-spacing: -0.02em;
    }

    .brand-edition {
        margin-top: 2px;
        color: var(--accent);
        font-size: 0.66em;
        font-weight: 600;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        white-space: nowrap;
    }

    .brand-role {
        margin-top: 4px;
        color: var(--text);
        font-size: 0.74em;
        opacity: 0.72;
    }

    .brand-lockup.compact {
        gap: 8px;
    }

    .brand-lockup.compact .brand-logo {
        width: 34px;
        height: 34px;
    }

    .brand-lockup.compact .brand-name {
        font-size: 0.92em;
    }

    .brand-lockup.compact .brand-edition {
        font-size: 0.52em;
        letter-spacing: 1px;
    }

    .brand-lockup.compact .brand-role {
        margin-top: 2px;
        font-size: 0.58em;
    }
</style>
