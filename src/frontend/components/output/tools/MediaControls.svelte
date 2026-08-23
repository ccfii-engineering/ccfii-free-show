<script lang="ts">
    import { onDestroy } from "svelte"
    import type { Unsubscriber } from "svelte/store"
    import type { Output } from "../../../../types/Output"
    import type { MediaType, ShowType } from "../../../../types/Show"
    import { isGpuGeneration, sendPlaybackCommand } from "../../../outputState/playbackCommands"
    import { getPlaybackSnapshot, subscribePlaybackState } from "../../../outputState/playbackStore"
    import { activeFocus, activeShow, focusMode, outLocked, playerVideos } from "../../../stores"
    import { triggerClickOnEnterSpace } from "../../../utils/clickable"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { splitPath } from "../../helpers/get"
    import { getExtension, getMediaType } from "../../helpers/media"
    import { setOutput } from "../../helpers/output"
    import FloatingInputs from "../../input/FloatingInputs.svelte"
    import Button from "../../inputs/Button.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import { VideoPlayer } from "../../media/video/videoPlayer"
    import { videoSync } from "../../media/video/videoSync"
    import VideoSlider from "../VideoSlider.svelte"

    export let currentOutput: Output | null
    export let outputId: string
    export let big = false

    let videoData = { duration: 0, paused: true, loop: false, muted: false }
    let videoTime = 0

    // reset
    $: if (path) videoTime = 0

    $: background = currentOutput?.out?.background
    $: path = background?.path || background?.id
    $: type = background?.type || "image"
    if (path && !type) type = getMediaType(getExtension(path)) as MediaType

    // LISTENER

    let legacyUnsubscriber: Unsubscriber | null = null
    let canonicalUnsubscriber: Unsubscriber | null = null
    let pathChangeTimer: ReturnType<typeof setTimeout> | null = null
    $: schedulePathChanged(path, outputId, type)

    function schedulePathChanged(path: string | undefined, outputId: string, type: MediaType) {
        if (pathChangeTimer) clearTimeout(pathChangeTimer)
        pathChangeTimer = setTimeout(() => {
            pathChangeTimer = null
            pathChanged(path, outputId, type)
        })
    }

    function pathChanged(path: string | undefined, outputId: string, type: MediaType) {
        if (legacyUnsubscriber) {
            legacyUnsubscriber()
            legacyUnsubscriber = null
        }
        if (canonicalUnsubscriber) {
            canonicalUnsubscriber()
            canonicalUnsubscriber = null
        }

        updateVideoState({ currentTime: 0, duration: 0, paused: true, loop: background?.loop ?? false, muted: background?.muted ?? false })
        if (!path || (type !== "video" && type !== "player")) return

        let gpuOwnsPlayback = false
        if (type === "video") {
            canonicalUnsubscriber = subscribePlaybackState((state) => {
                const snapshot = state.snapshots[outputId]
                const identityMatches = snapshot?.identity === path
                gpuOwnsPlayback = !!snapshot && identityMatches && isGpuGeneration(snapshot.generation)
                if (!gpuOwnsPlayback) return

                updateVideoState({ currentTime: snapshot.progress, duration: snapshot.duration, paused: snapshot.paused, loop: snapshot.loop, muted: snapshot.muted })
            })
        }

        legacyUnsubscriber = videoSync(path, outputId, (data) => {
            if (gpuOwnsPlayback) return
            updateVideoState(data)
        })
    }

    function updateVideoState(data: { currentTime: number; duration: number; paused: boolean; loop: boolean; muted: boolean }) {
        videoTime = data.currentTime || 0
        videoData.duration = data.duration || 0
        videoData.paused = data.paused
        videoData.loop = data.loop
        videoData.muted = data.muted
    }

    onDestroy(() => {
        if (pathChangeTimer) clearTimeout(pathChangeTimer)
        if (legacyUnsubscriber) legacyUnsubscriber()
        if (canonicalUnsubscriber) canonicalUnsubscriber()
    })

    // $: if (path && videoData) VideoPlayer.updateProperties(path, videoData, outputId)

    let mediaName = ""
    $: outName = path && path.includes(".") && !path.includes("base64") ? splitPath(path).name : ""
    $: mediaName = outName ? outName.slice(0, outName.lastIndexOf(".")) : background?.name || ""

    // $: activeOutputIds = getActiveOutputs($outputs, true, true, true)

    function toggleMute() {
        if (!path) return

        const muted = !videoData.muted
        videoData.muted = muted
        if (background && getActiveGpuSnapshot()) {
            sendPlaybackCommand(outputId, { type: muted ? "mute" : "unmute" })
            setOutput("background", { ...background, muted }, false, outputId)
        }
        VideoPlayer.toggleMute(path, outputId)
    }

    function toggleLoop() {
        if (!path) return

        const loop = !videoData.loop
        videoData.loop = loop
        if (background && getActiveGpuSnapshot()) setOutput("background", { ...background, loop }, false, outputId)
        VideoPlayer.toggleLoop(path, outputId)
    }

    function openPreview() {
        if (!background || !path) return

        if ($focusMode) activeFocus.set({ id: path, type: type as ShowType })
        else activeShow.set({ id: path, type: type as ShowType })
    }

    function playPause() {
        if (!path) return

        const isPaused = videoData.paused
        videoData.paused = !isPaused

        if (isPaused) resumePlayback()
        else pausePlayback()
    }

    function pausePlayback() {
        if (!path) return
        if (getActiveGpuSnapshot()) sendPlaybackCommand(outputId, { type: "pause" })
        VideoPlayer.pause(path, outputId)
    }

    function resumePlayback() {
        if (!path) return
        if (getActiveGpuSnapshot()) sendPlaybackCommand(outputId, { type: "resume" })
        VideoPlayer.play(path, outputId)
    }

    function seekPlayback(time: number) {
        if (!path) return
        if (getActiveGpuSnapshot()) sendPlaybackCommand(outputId, { type: "seek", time })
        VideoPlayer.seekTo(path, outputId, time)
    }

    function getActiveGpuSnapshot() {
        if (!path || type !== "video") return null

        const snapshot = getPlaybackSnapshot(outputId)
        if (!snapshot || !isGpuGeneration(snapshot.generation)) return null
        if (snapshot.identity !== path) return null
        return snapshot
    }

    let changeValue = 0
</script>

{#if background}
    {#if big}
        <!--  -->
        {#if type === "video" || background?.type === "player"}
            <FloatingInputs side="center" style="width: 80%;">
                <MaterialButton title={videoData.paused ? "media.play" : "media.pause"} disabled={$outLocked} on:click={playPause}>
                    <Icon id={videoData.paused ? "play" : "pause"} white={videoData.paused} size={1.5} />
                </MaterialButton>

                <div class="divider" />

                <VideoSlider {outputId} {path} disabled={$outLocked} bind:videoData bind:videoTime bind:changeValue {pausePlayback} {resumePlayback} {seekPlayback} big />

                <div class="divider" />

                <MaterialButton
                    title="media.back10"
                    on:click={() => {
                        changeValue = Math.max(videoTime - 10, 0.01)
                    }}
                >
                    <Icon id="back_10" white size={1.3} />
                </MaterialButton>
                <MaterialButton
                    title="media.forward10"
                    on:click={() => {
                        changeValue = Math.min(videoTime + 10, videoData.duration - 0.1)
                    }}
                >
                    <Icon id="forward_10" white size={1.3} />
                </MaterialButton>

                <div class="divider" />

                <MaterialButton title={"media._loop" + (videoData.loop !== false ? ": settings.enabled" : "")} on:click={toggleLoop}>
                    <Icon id="loop" white={!videoData.loop} size={1.3} />
                </MaterialButton>

                <MaterialButton title={videoData.muted === false ? "actions.mute" : "actions.unmute"} disabled={$outLocked} on:click={toggleMute}>
                    <Icon id={videoData.muted === false ? "volume" : "muted"} white={videoData.muted !== false} size={1.3} />
                </MaterialButton>
            </FloatingInputs>
        {/if}
    {:else}
        <span class="name" style="font-size: 0.9em;" role="button" tabindex="0" on:click={openPreview} on:keydown={triggerClickOnEnterSpace}>
            {#if background?.type === "player"}
                <p>{$playerVideos[background?.id || ""]?.name || "—"}</p>
            {:else}
                <p>{mediaName || "—"}</p>
            {/if}
        </span>

        {#if type === "video" || background?.type === "player"}
            <span class="group">
                <Button center title={translateText(videoData.paused ? "media.play" : "media.pause")} disabled={$outLocked} on:click={playPause}>
                    <Icon id={videoData.paused ? "play" : "pause"} white={videoData.paused} size={1.2} />
                </Button>

                <VideoSlider {outputId} {path} disabled={$outLocked} bind:videoData bind:videoTime bind:changeValue {pausePlayback} {resumePlayback} {seekPlayback} />

                <Button
                    center
                    title={translateText("media.forward10")}
                    on:click={() => {
                        changeValue = Math.min(videoTime + 10, videoData.duration - 0.1)
                    }}
                >
                    <Icon id="forward_10" white size={1.2} />
                </Button>
                <Button center title={translateText("media._loop" + (videoData.loop ? ": settings.enabled" : ""))} on:click={toggleLoop}>
                    <Icon id="loop" white={!videoData.loop} size={1.2} />
                </Button>
                <Button center title={translateText(videoData.muted === false ? "actions.mute" : "actions.unmute")} disabled={$outLocked} on:click={toggleMute}>
                    <Icon id={videoData.muted === false ? "volume" : "muted"} white={videoData.muted !== false} size={1.2} />
                </Button>
            </span>
        {/if}
    {/if}
{/if}

<style>
    .group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
    }
    .group :global(button) {
        padding: 0.3em !important;
    }

    .name {
        display: flex;
        justify-content: center;
        padding: 3px 10px;
        opacity: 0.8;

        outline: none !important;
        cursor: pointer;
    }

    .name:hover {
        background-color: var(--primary-darker);
    }
    .name:focus {
        outline: 2px solid var(--secondary);
        outline-offset: 2px;
    }
</style>
