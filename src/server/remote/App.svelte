<script lang="ts">
    import "../common/brand.css"
    import Center from "../common/components/Center.svelte"
    import Brand from "../common/components/Brand.svelte"
    import Error from "../common/components/Error.svelte"
    import Auth from "./components/Auth.svelte"
    import Main from "./components/Main.svelte"
    import { translate } from "./util/helpers"
    import { initSocket } from "./util/socket"
    import { dictionary, errors, isConnected, password } from "./util/stores"

    initSocket()

    // test API actions
    // send("API:get_playlists")
</script>

<Error errors={$errors} />

{#if $isConnected}
    <Main />
{:else if $password.required}
    <Auth />
{:else}
    <Center>
        <Brand role="Remote" />
        <p style="margin-top: 12px;">{translate("remote.loading", $dictionary)}</p>
    </Center>
{/if}

<svelte:head>
    <style>
        :root {
            /* --navigation-width: 18vw; */
            --navigation-width: 300px;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            user-select: none;

            outline-offset: -4px;
            outline-color: var(--accent);
        }

        html {
            height: 100%;
            font-family: var(--font-family);
            font-size: var(--font-size);
        }

        body {
            background-color: var(--primary);
            color: var(--text);
            transition: background-color 0.5s;

            font-family: inherit;
            font-size: inherit;

            height: 100%;
            display: flex;
            flex-direction: column;
            touch-action: manipulation;
        }

        /* Match FreeShow main app scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track,
        ::-webkit-scrollbar-corner {
            background: rgb(255 255 255 / 0.05);
        }
        ::-webkit-scrollbar-thumb {
            background: rgb(255 255 255 / 0.3);
            border-radius: 8px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgb(255 255 255 / 0.5);
        }

        /* Firefox scrollbar */
        * {
            scrollbar-width: thin;
            scrollbar-color: rgb(255 255 255 / 0.3) rgb(255 255 255 / 0.05);
        }

        h1 {
            color: var(--accent);
            text-align: center;
            padding-bottom: 20px;
        }

        h2 {
            color: var(--accent);
            text-align: center;
            font-size: 1.3em;
            padding: 0;
            width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin: 0;
        }

        .header {
            display: flex;
            justify-content: center;
            align-items: center;

            background-color: var(--primary-darker);
            color: var(--text);
            width: 100%;

            height: 56px; /* Match show item height */
            font-weight: 600;
            font-size: 1.05em;
        }

        /* CHECKERED */

        .checkered {
            /* background-color: var(--transparent); */
            background: repeating-conic-gradient(rgba(70, 70, 80, 0.1) 0% 25%, transparent 0% 50%) 50% / 26px 26px;
        }
    </style>
</svelte:head>
