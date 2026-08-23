<svelte:options immutable={true} />

<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { Unsubscriber } from "svelte/store"
    import { uid } from "uid"
    import { OUTPUT } from "../../../../types/Channels"
    import type { MediaStyle } from "../../../../types/Main"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, Transition } from "../../../../types/Show"
    import { AudioAnalyser } from "../../../audio/audioAnalyser"
    import { audioChannelsData, currentWindow, media, outputs, playerVideos, playingVideos, special, videosData, videosTime, volume } from "../../../stores"
    import { isGpuGeneration } from "../../../outputState/playbackCommands"
    import type { PlaybackSnapshot } from "../../../outputState/playbackState"
    import { sendPlaybackReport, subscribePlaybackState } from "../../../outputState/playbackStore"
    import { destroy, receive, send } from "../../../utils/request"
    import BmdStream from "../../drawer/live/BMDStream.svelte"
    import NdiStream from "../../drawer/live/NDIStream.svelte"
    import { getMediaStyle } from "../../helpers/media"
    import { getPreviewVideoSyncUpdate } from "../videoPreviewSync"
    import Player from "../../system/Player.svelte"
    import Camera from "../Camera.svelte"
    import OutputTransition from "../transitions/OutputTransition.svelte"
    import Window from "../Window.svelte"
    import Media from "./Media.svelte"
    import { isVideoTimeReset } from "../webgpu/videoControlState"

    export let outputId = ""

    export let data: OutBackground
    export let transition: Transition
    export let fadingOut = false
    export let currentStyle: Styles | null = null
    export let animationStyle = ""
    export let duration = 0
    export let mirror = false
    export let styleBackground = false

    $: id = data.path || data.id || ""

    let type = "media"
    $: type = data.type || "media"
    $: if (type === "video" || type === "image") type = "media"

    let mediaStyle: MediaStyle = {}
    $: if (data && currentStyle) mediaStyle = getMediaStyle(data, currentStyle)

    // VIDEO

    let videoData = { duration: 0, paused: true, muted: true, loop: styleBackground }
    let videoTime = 0

    // let videoDuration = 0
    // if (!videoData.duration && duration) videoData.duration = videoDuration
    // else if (videoData.duration && videoDuration !== videoData.duration) videoDuration = videoData.duration

    // always muted in mirror (draw/key)
    $: if (mirror && !videoData.muted) videoData.muted = true
    // video values updated
    $: if (!mirror && (data.muted !== undefined || data.loop !== undefined)) updateValues()
    function updateValues() {
        if (fadingOut) return

        videoData.muted = data.muted ?? true
        videoData.loop = data.loop ?? false
    }
    // draw

    let previewPlaybackUnsubscriber: Unsubscriber | null = null
    let gpuOwnsPreviewPlayback = false
    $: configurePreviewPlaybackSync(mirror, styleBackground, outputId, id)

    function configurePreviewPlaybackSync(mirror: boolean, styleBackground: boolean, outputId: string, identity: string) {
        stopPreviewPlaybackSync()
        if (!mirror || styleBackground || !outputId || !identity) return

        previewPlaybackUnsubscriber = subscribePlaybackState((state) => {
            const snapshot = state.snapshots[outputId]
            gpuOwnsPreviewPlayback = !!snapshot && isGpuGeneration(snapshot.generation)
            if (!gpuOwnsPreviewPlayback || snapshot?.identity !== identity) return

            applyPreviewPlaybackSnapshot(snapshot)
        })
    }

    function applyPreviewPlaybackSnapshot(snapshot: PlaybackSnapshot) {
        const update = getPreviewVideoSyncUpdate({
            fadingOut,
            localPaused: videoData.paused,
            localTime: videoTime,
            remotePaused: snapshot.paused,
            remoteTime: snapshot.progress
        })

        // This component is immutable, so replace the object to propagate playback changes
        // through the Media/Video bindings instead of mutating the existing reference.
        videoData = { ...videoData, duration: snapshot.duration, paused: snapshot.paused, loop: snapshot.loop, muted: true }
        if (update) videoTime = update.time
    }

    function stopPreviewPlaybackSync() {
        previewPlaybackUnsubscriber?.()
        previewPlaybackUnsubscriber = null
        gpuOwnsPreviewPlayback = false
    }

    onDestroy(stopPreviewPlaybackSync)

    // Without the second if, legacy preview videos don't actually play but just skip ahead
    // when kept in sync with the setTimeout(). GPU previews use the canonical snapshot above.
    $: if (mirror && !styleBackground && !gpuOwnsPreviewPlayback && $videosData[outputId]?.paused) videoData.paused = true
    $: if (mirror && !styleBackground && !gpuOwnsPreviewPlayback && $videosData[outputId]?.paused === false) videoData.paused = false

    $: if (mirror && !styleBackground && !gpuOwnsPreviewPlayback && $videosTime[outputId] !== undefined) setPreviewVideoTime()
    function setPreviewVideoTime() {
        // timeout in case video is going to fade out
        setTimeout(() => {
            if (gpuOwnsPreviewPlayback) return

            const update = getPreviewVideoSyncUpdate({
                fadingOut,
                localPaused: videoData.paused,
                localTime: videoTime,
                remotePaused: $videosData[outputId]?.paused,
                remoteTime: $videosTime[outputId]
            })
            if (!update) return

            videoTime = update.time
            videoData.paused = update.paused
        }, 50)
    }

    let lastSentVideoData = ""
    let lastReportedTime = Number.NaN
    const playbackSourceId = `dom-${uid()}`
    $: if (!mirror && !fadingOut) sendVideoData(videoData)
    $: if (!mirror && !fadingOut) sendVideoTime(videoTime)

    let sendingTimeout: NodeJS.Timeout | null = null
    let timeUpdateTimeout = 220
    function sendVideoData(data: typeof videoData) {
        // canonical per-output playback state (#16)
        sendPlaybackReport({ outputId, sourceId: playbackSourceId, role: "visual", identity: id, duration: data?.duration || 0, progress: videoTime, paused: data?.paused ?? true, loop: data?.loop ?? false, muted: data?.muted ?? true })

        const next = JSON.stringify(data)
        if (next === lastSentVideoData) return

        lastSentVideoData = next
        send(OUTPUT, ["MAIN_DATA"], { [outputId]: data })
    }
    function sendVideoTime(time: number) {
        if (sendingTimeout) return

        const wrapped = isVideoTimeReset(time, lastReportedTime)
        lastReportedTime = time

        // canonical per-output playback state (#16) — wraps bypass the throttle like GPU reports do
        sendPlaybackReport({ outputId, sourceId: playbackSourceId, role: "visual", identity: id, duration: videoData?.duration || 0, progress: time, paused: videoData?.paused ?? true, loop: videoData?.loop ?? false, muted: videoData?.muted ?? true, ...(wrapped ? { event: "wrap" } : {}) })

        send(OUTPUT, ["MAIN_TIME"], { [outputId]: time })
        sendingTimeout = setTimeout(() => {
            if (fadingOut) return

            send(OUTPUT, ["MAIN_TIME"], { [outputId]: time })
            sendingTimeout = null
        }, timeUpdateTimeout)
    }

    const videoReceiver = {
        TIME: (data: any) => {
            let outputData = data[outputId]
            if (!outputData || fadingOut) return

            videoTime = outputData
        },
        DATA: (data: any) => {
            let outputData = data[outputId]
            if (!outputData || fadingOut) return

            videoData = { ...outputData, duration: videoData.duration || 0 }
        }
    }

    let listenerId = ""
    let receiving = false

    let mounted = false
    onMount(() => (mounted = true))
    $: if (id && !fadingOut && mounted) startReceiver()
    function startReceiver() {
        const isStage = !!Object.values($outputs)[0]?.stageOutput
        if ((mirror && !isStage) || receiving) return
        receiving = true

        destroy(OUTPUT, listenerId)

        listenerId = "MEDIA_RECEIVE_" + uid(5)
        receive(OUTPUT, videoReceiver, listenerId)
    }

    onDestroy(removeReceiver)
    $: if (fadingOut || id) removeReceiver()
    function removeReceiver() {
        if (mirror || !receiving || !mounted) return
        receiving = false

        destroy(OUTPUT, listenerId)
    }

    // call end just before (to make room for transition) - this also triggers video ended on loop
    $: if (videoData.duration && videoTime >= videoData.duration - (duration / 1000 + 0.1)) videoEnded()

    let endedCalled = false
    function videoEnded() {
        if (fadingOut || mirror || endedCalled) return

        endedCalled = true
        setTimeout(() => (endedCalled = false), duration || 1000)

        send(OUTPUT, ["MAIN_VIDEO_ENDED"], { id: outputId, loop: videoData.loop, duration })
    }

    // FADE OUT AUDIO

    $: audioChannelVolume = $audioChannelsData[outputId]?.volume ?? 1
    $: isMuted = !!($audioChannelsData[outputId]?.isMuted || $audioChannelsData.main?.isMuted)
    // $: if (isMuted !== undefined) setMuted(isMuted)
    // function setMuted(muted: boolean) {
    //     if (!video) return
    //     video.muted = muted
    // }

    $: if (fadingOut && !videoData.muted) fadeoutVideo()
    $: if (!fadingOut && !videoData.muted && id) setVolume($volume * (isMuted ? 0 : 1) * audioChannelVolume * (($media[id]?.volume ?? currentStyle?.volume ?? 100) / 100))
    const speed = 0.01
    const margin = 0.9 // video should fade to 0 before clearing
    function fadeoutVideo() {
        if (mirror || !video || !fadingOut || !duration) return

        let time = duration * speed * margin
        setTimeout(() => {
            if (!video) return

            video.volume = Math.max(0, Number((video.volume - speed).toFixed(3)))
            fadeoutVideo()
        }, time)
    }
    function setVolume(volume: number) {
        if (!video || !isFinite(volume) || isNaN(volume)) return
        video.volume = Math.max(0, Math.min(1, volume))
    }

    // AUDIO

    $: videoExists = !!video
    $: if ($currentWindow === "output" && videoExists) analyseVideo()

    onDestroy(() => {
        if ($currentWindow !== "output" || !previousPath) return

        AudioAnalyser.detach(previousPath)

        // playingVideos.set([])
        playingVideos.update((a) => {
            let videoIndex = a.findIndex((a) => a.id === previousPath)
            if (videoIndex > -1) a.splice(videoIndex, 1)
            return a
        })
    })

    // analyse video audio
    let video: HTMLVideoElement | undefined
    // previousPath is probably not needed as component is unmounted on new path
    let previousPath = id
    function analyseVideo() {
        if (fadingOut || $playingVideos[0]?.id === id) return
        if (previousPath && previousPath !== id) {
            AudioAnalyser.detach(previousPath)
        }
        if (!video) return

        playingVideos.set([{ id, video }])
        AudioAnalyser.attach(id, video)
        AudioAnalyser.recorderActivate()
        previousPath = id
    }
</script>

<OutputTransition {transition} inTransition={transition.in} outTransition={transition.out} on:outrostart={() => (fadingOut = true)}>
    {#if type === "media"}
        <Media path={id} {data} {animationStyle} bind:video bind:videoData bind:videoTime {mirror} {mediaStyle} on:loaded on:ended={videoEnded} />
    {:else if type === "screen"}
        <Window {id} class="media" style="width: 100%;height: 100%;" on:loaded />
    {:else if type === "ndi"}
        {#key id}
            <NdiStream screen={{ id, name: "" }} background {mirror} />
        {/key}
    {:else if type === "blackmagic"}
        <BmdStream screen={{ id, name: "" }} background {mirror} />
    {:else if type === "camera"}
        <Camera {id} groupId={data.cameraGroup || ""} class="media" style="width: 100%;height: 100%;" on:loaded />
    {:else if type === "player"}
        <!-- prevent showing controls in output -->
        {#if $special.hideCursor || $playerVideos[id]?.type !== "youtube"}<div class="overlay" />{/if}
        <Player {outputId} {id} bind:videoData bind:videoTime startAt={data.startAt} on:loaded on:ended={videoEnded} />
    {/if}
</OutputTransition>

<style>
    /* div :global(.media) {
        max-width: 100%;
        max-height: 100%;
    } */

    .overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: transparent;
        z-index: 1;
    }
</style>
