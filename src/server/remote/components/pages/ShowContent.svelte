<script lang="ts">
    import type { RemoteMediaSelection } from "../../../../types/remote/control"
    import { active } from "../../util/stores"
    import AudioPreview from "../show/AudioPreview.svelte"
    import OverlayPreview from "../show/OverlayPreview.svelte"
    import Media from "./Media.svelte"
    import PdfPreview from "./PdfPreview.svelte"

    export let tablet: boolean = false

    $: activeShow = $active
    $: remoteMedia = activeShow.data?.remoteMedia as RemoteMediaSelection | undefined
</script>

{#if remoteMedia && (activeShow.type === "image" || activeShow.type === "video" || activeShow.type === "audio" || activeShow.type === "player")}
    <Media {tablet} />
{:else if activeShow.type === "image" || activeShow.type === "video"}
    <Media {tablet} />
{:else if activeShow.type === "audio"}
    <AudioPreview active={activeShow} />
{:else if activeShow.type === "overlay"}
    <OverlayPreview show={activeShow} />
{:else if activeShow.type === "pdf"}
    <PdfPreview active={activeShow} {tablet} />
{:else if activeShow.type === "player"}
    <!-- Online media / player content -->
    <Media {tablet} />
{:else}
    <p style="text-transform: capitalize;">{activeShow.type}</p>
{/if}
