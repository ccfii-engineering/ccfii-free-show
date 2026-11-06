<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { MAX_THUMBNAIL_BYTES, type RemoteMediaPlayRequest, type RemoteMediaSelection } from "../../../../types/remote/control"
    import Icon from "../../../common/components/Icon.svelte"
    import { translate } from "../../util/helpers"
    import { onResponse, send } from "../../util/socket"
    import { active, activeDrawerTab, activeTab, dictionary, drawer, isConnected, mediaCache, outData, playingAudioData, playingAudioTime, playingVideoDuration, playingVideoLoop, playingVideoMuted, playingVideoPaused, playingVideoTime } from "../../util/stores"
    import { joinTime, secondsToTime } from "../../../common/util/time"

    export let tablet = false

    $: path = $active?.id
    $: mediaType = $active?.type
    $: remoteMedia = $active?.data?.remoteMedia as RemoteMediaSelection
    $: remoteItem = remoteMedia?.item
    $: isRemoteMedia = !!remoteItem && remoteItem.path === path
    $: thumbnailPath = (isRemoteMedia && remoteMedia.thumbnail) || $mediaCache[path]
    $: hasThumbnail = !!thumbnailPath

    // Is this a video type?
    $: isVideo = mediaType === "video" || mediaType === "player"

    // Check if this item is currently playing in output
    $: background = $outData?.background
    $: backgroundPath = background?.path || background?.id || ""
    $: isAudioPlayingInOutput = isRemoteMedia && remoteItem?.kind === "audio" && $playingAudioData?.id === path
    $: isPlayingInOutput = isAudioPlayingInOutput || (path && backgroundPath === path)

    // Video state (only relevant when playing in output)
    $: videoTime = $playingVideoTime || 0
    $: videoDuration = $playingVideoDuration || 0
    $: isPaused = $playingVideoPaused
    $: isLooping = $playingVideoLoop
    $: isMuted = $playingVideoMuted

    // Local settings (for when not yet outputting)
    let shouldLoop = false
    let shouldMute = false
    let launchRequestId = ""
    let launchMessage = ""
    let launchError = ""
    let thumbnailRequestId = ""
    let requestedThumbnailPath = ""
    let thumbnailError = ""
    let requestCounter = 0

    // Playback polling (keep remote UI responsive)
    const POLL_PLAYING = 500
    const POLL_PAUSED = 2000
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let pollRate = POLL_PAUSED
    let mounted = false
    let audioPoll: ReturnType<typeof setInterval> | null = null
    let audioPollPath = ""

    $: if (isRemoteMedia) {
        shouldLoop = remoteMedia.loop ?? false
        shouldMute = remoteMedia.muted ?? false
    }

    $: if (path !== requestedThumbnailPath) {
        requestedThumbnailPath = ""
        thumbnailRequestId = ""
        thumbnailError = ""
    }

    $: if (isRemoteMedia && (remoteItem?.kind === "image" || remoteItem?.kind === "video") && !remoteMedia.thumbnail && !thumbnailRequestId && !requestedThumbnailPath && $isConnected) {
        requestedThumbnailPath = path
        thumbnailRequestId = makeRequestId()
        send("MEDIA_THUMBNAIL", { requestId: thumbnailRequestId, path })
    }

    onMount(() => {
        mounted = true
        if (isVideo && isPlayingInOutput) startPolling()
        const unsubscribers = [onResponse("MEDIA_PLAY_RESULT", handlePlayResult), onResponse("MEDIA_THUMBNAIL_RESULT", handleThumbnailResult), onResponse("MEDIA_ERROR", handleMediaError)]
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
    })

    onDestroy(() => {
        stopPolling()
        if (audioPoll) clearInterval(audioPoll)
    })

    function makeRequestId() {
        requestCounter += 1
        return `${Date.now().toString(36)}-${requestCounter.toString(36)}`
    }

    function handlePlayResult(data: { requestId: string; ok: boolean; code?: string }) {
        if (data.requestId !== launchRequestId) return
        launchRequestId = ""
        if (!data.ok) {
            launchError = "This media could not be started. Try again."
            return
        }

        launchMessage = "Sent to output"
        launchError = ""
        if ($isConnected) {
            send("API:get_cleared")
            if (remoteItem?.kind === "audio") send("API:get_playing_audio_data")
        }
    }

    function handleThumbnailResult(data: { requestId: string; path: string; thumbnail: string }) {
        if (data.requestId !== thumbnailRequestId || data.path !== path) return
        thumbnailRequestId = ""
        if (!data.thumbnail || data.thumbnail.length > MAX_THUMBNAIL_BYTES) {
            thumbnailError = "Preview unavailable. You can still send this media to the output."
            return
        }

        active.update((current) => {
            if (current.id !== data.path || !current.data?.remoteMedia) return current
            return { ...current, data: { ...current.data, remoteMedia: { ...current.data.remoteMedia, thumbnail: data.thumbnail } } }
        })
        thumbnailError = ""
    }

    function handleMediaError(data: { requestId: string; code: string }) {
        if (data.requestId === thumbnailRequestId) {
            thumbnailRequestId = ""
            thumbnailError = data.code === "thumbnail_busy" ? "Preview is busy. Try again in a moment." : data.code === "too_large" ? "This preview is too large to load. You can still send the media to the output." : "Preview unavailable. You can still send this media to the output."
        } else if (data.requestId === launchRequestId) {
            launchRequestId = ""
            launchError = "This media could not be started. Try again."
        }
    }

    function retryThumbnail() {
        if (!$isConnected || !isRemoteMedia) return
        thumbnailError = ""
        thumbnailRequestId = ""
        requestedThumbnailPath = ""
    }

    function playInOutput() {
        if (isRemoteMedia) {
            if (!$isConnected || launchRequestId) return
            launchRequestId = makeRequestId()
            launchMessage = ""
            launchError = ""
            const request: RemoteMediaPlayRequest = { requestId: launchRequestId, path, loop: shouldLoop, muted: shouldMute }
            send("MEDIA_PLAY", request)
            return
        }
        if (!$isConnected) return
        send("API:play_media", { path, data: { type: mediaType, loop: shouldLoop, muted: shouldMute } })
        send("API:get_cleared")
    }

    function togglePlayPause() {
        if (!$isConnected) return
        send("API:toggle_playing_media")
        scheduleRefresh()
    }

    function toggleLoop() {
        if (isPlayingInOutput) {
            if (!$isConnected) return
            send("API:toggle_media_loop")
            scheduleRefresh()
        } else {
            setRemoteOption("loop", !shouldLoop)
        }
    }

    function toggleMute() {
        if (isPlayingInOutput) {
            if (!$isConnected) return
            send("API:toggle_media_mute")
            scheduleRefresh()
        } else {
            setRemoteOption("muted", !shouldMute)
        }
    }

    function setRemoteOption(name: "loop" | "muted", value: boolean) {
        if (isRemoteMedia) {
            active.update((current) => {
                if (!current.data?.remoteMedia) return current
                return { ...current, data: { ...current.data, remoteMedia: { ...current.data.remoteMedia, [name]: value } } }
            })
        } else if (name === "loop") shouldLoop = value
        else shouldMute = value
    }

    function seekRelative(delta: number) {
        const target = Math.max(0, Math.min(videoTime + delta, videoDuration || 0))
        seekTo(target)
    }

    function seekTo(value: number) {
        if (!$isConnected) return
        send("API:video_seekto", { seconds: value })
        scheduleRefresh()
    }

    function fetchVideoState() {
        if (!isVideo || !isPlayingInOutput || !$isConnected) return
        send("API:get_playing_video_state")
    }

    function toggleAudioPlayback() {
        if (!isAudioPlayingInOutput || !$isConnected) return
        if ($playingAudioData?.paused) send("API:play_audio", { path })
        else send("API:pause_audio", { path })
        send("API:get_playing_audio_data")
    }

    function returnToMedia() {
        if (tablet) {
            activeDrawerTab.set("media")
            drawer.update((current) => (current.height <= 40 ? { ...current, height: current.stored || 400 } : current))
        } else activeTab.set("media")
    }

    function startPolling() {
        if (pollInterval || !isVideo || !isPlayingInOutput || !$isConnected) return
        fetchVideoState()
        pollInterval = setInterval(fetchVideoState, pollRate)
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
        }
    }

    function restartPolling() {
        stopPolling()
        startPolling()
    }

    function scheduleRefresh() {
        if (!isVideo || !isPlayingInOutput || !$isConnected) return
        setTimeout(fetchVideoState, 75)
        setTimeout(fetchVideoState, 300)
    }

    $: if (mounted) {
        if (isVideo && isPlayingInOutput && $isConnected) {
            const nextRate = isPaused ? POLL_PAUSED : POLL_PLAYING
            if (pollRate !== nextRate) {
                pollRate = nextRate
                restartPolling()
            } else if (!pollInterval) {
                startPolling()
            }
        } else {
            stopPolling()
        }
    }

    $: displayTime = isPlayingInOutput ? videoTime : 0
    $: displayDuration = isPlayingInOutput ? videoDuration : 0

    $: if (mounted && isRemoteMedia && remoteItem?.kind === "audio" && $isConnected) {
        if (audioPollPath !== path) {
            if (audioPoll) clearInterval(audioPoll)
            audioPollPath = path
            send("API:get_playing_audio_data")
            send("API:get_playing_audio_time")
            audioPoll = setInterval(() => {
                if (!$isConnected) return
                send("API:get_playing_audio_time")
                send("API:get_playing_audio_data")
            }, 1000)
        }
    } else if (audioPoll) {
        clearInterval(audioPoll)
        audioPoll = null
        audioPollPath = ""
    } else {
        audioPollPath = ""
    }
</script>

{#if isRemoteMedia}
    <section class="remote-media-page" aria-label="Selected media">
        <header class="remote-media-header">
            <button class="browse-back" type="button" on:click={returnToMedia}>
                <Icon id="back" size={1.15} />
                <span>Back to media</span>
            </button>
            <div class="remote-media-copy">
                <h2>{remoteItem.name}</h2>
                <p>{remoteItem.kind} <span aria-hidden="true">·</span> {remoteMedia.location}</p>
            </div>
        </header>

        {#if !$isConnected}
            <p class="connection-message" role="status">
                Connection lost. {#if hasThumbnail}Showing the last available preview.{/if} Playback controls are unavailable until the presentation computer reconnects.
            </p>
        {/if}

        <div class="remote-preview" class:has-thumbnail={hasThumbnail} aria-busy={!!thumbnailRequestId}>
            {#if hasThumbnail}
                <img src={thumbnailPath} alt={`Preview of ${remoteItem.name}`} draggable="false" />
            {:else}
                <div class="remote-placeholder">
                    <Icon id={remoteItem.kind === "audio" ? "music" : remoteItem.kind} size={3} />
                    <strong>{remoteItem.name}</strong>
                    <span>{thumbnailRequestId ? "Loading preview…" : thumbnailError || "Preview unavailable"}</span>
                </div>
            {/if}
            {#if isPlayingInOutput}
                <span class="live-label">{$isConnected ? "Live on output" : "Last seen on output"}</span>
            {/if}
        </div>
        {#if thumbnailError && (remoteItem.kind === "image" || remoteItem.kind === "video")}
            <div class="thumbnail-error" role="status">
                <span>{thumbnailError}</span>
                <button type="button" on:click={retryThumbnail} disabled={!$isConnected}>Retry preview</button>
            </div>
        {/if}

        <div class="remote-media-actions">
            {#if isPlayingInOutput}
                {#if isVideo}
                    <div class="video-time-control">
                        <span class="time">{joinTime(secondsToTime(Math.floor(displayTime)))}</span>
                        <input aria-label="Seek video" type="range" min="0" max={Math.max(displayDuration || 1, 1)} step="1" value={displayTime} on:change={(event) => seekTo(Number(event.currentTarget.value))} disabled={!$isConnected} />
                        <span class="time">{displayDuration > 0 ? joinTime(secondsToTime(Math.floor(displayDuration))) : "--:--"}</span>
                    </div>
                    <div class="media-control-row">
                        <button type="button" class="primary-control" on:click={togglePlayPause} disabled={!$isConnected} aria-label={isPaused ? "Play video" : "Pause video"}>
                            <Icon id={isPaused ? "play" : "pause"} size={1.1} />
                            <span>{isPaused ? "Play" : "Pause"}</span>
                        </button>
                        <button type="button" on:click={() => seekRelative(-10)} disabled={!$isConnected} aria-label="Back 10 seconds">
                            <Icon id="back_10" size={1.1} /> <span>−10s</span>
                        </button>
                        <button type="button" on:click={() => seekRelative(10)} disabled={!$isConnected} aria-label="Forward 10 seconds">
                            <Icon id="forward_10" size={1.1} /> <span>+10s</span>
                        </button>
                        <button type="button" aria-pressed={isLooping} on:click={toggleLoop} disabled={!$isConnected}>
                            <Icon id="loop" size={1.1} /> <span>Loop {isLooping ? "on" : "off"}</span>
                        </button>
                        <button type="button" aria-pressed={isMuted} on:click={toggleMute} disabled={!$isConnected}>
                            <Icon id={isMuted ? "muted" : "volume"} size={1.1} /> <span>{isMuted ? "Unmute" : "Mute"}</span>
                        </button>
                    </div>
                {:else if remoteItem.kind === "audio"}
                    <div class="media-control-row audio-controls">
                        <span class="audio-time">{joinTime(secondsToTime(Math.floor($playingAudioTime || 0)))} / {joinTime(secondsToTime(Math.floor($playingAudioData?.duration || 0)))}</span>
                        <button type="button" class="primary-control" on:click={toggleAudioPlayback} disabled={!$isConnected}>
                            <Icon id={$playingAudioData?.paused ? "play" : "pause"} size={1.1} />
                            <span>{$playingAudioData?.paused ? "Play audio" : "Pause audio"}</span>
                        </button>
                    </div>
                {/if}
                {#if launchMessage}<p class="launch-status" role="status">{launchMessage}</p>{/if}
            {:else}
                {#if isVideo}
                    <div class="media-control-row options-row">
                        <button type="button" aria-pressed={shouldLoop} on:click={toggleLoop}>
                            <Icon id="loop" size={1.1} /> <span>Loop {shouldLoop ? "on" : "off"}</span>
                        </button>
                        <button type="button" aria-pressed={shouldMute} on:click={toggleMute}>
                            <Icon id={shouldMute ? "muted" : "volume"} size={1.1} /> <span>{shouldMute ? "Unmute" : "Mute"}</span>
                        </button>
                    </div>
                {/if}
                <button class="send-to-output" type="button" on:click={playInOutput} disabled={!$isConnected || !!launchRequestId}>
                    <Icon id="play" size={1.15} />
                    <span>{launchRequestId ? "Sending to output…" : remoteItem.kind === "image" ? "Show on output" : "Play on output"}</span>
                </button>
                {#if launchMessage}<p class="launch-status" role="status">{launchMessage}</p>{/if}
                {#if launchError}<p class="launch-error" role="alert">{launchError}</p>{/if}
            {/if}
        </div>
    </section>
{:else}
    <div class="media">
        {#if path}
            {#if isPlayingInOutput}
                {#if hasThumbnail}
                    <img src={thumbnailPath} alt="Preview" draggable="false" />
                {:else}
                    <div class="placeholder">
                        <Icon id={mediaType === "player" ? "player" : "video"} size={2.5} />
                        <p>{translate("remote.no_preview", $dictionary) || "No preview available"}</p>
                        <small style="opacity: 0.6; word-break: break-all;">{path}</small>
                    </div>
                {/if}

                <!-- Full playback controls when playing in output -->
                <div class="floating-controls center">
                    <div class="floating-bar">
                        <button class="float-btn play-pause" class:paused={isPaused} on:click={togglePlayPause} title={translate(isPaused ? "actions.play" : "actions.pause", $dictionary)}>
                            <Icon id={isPaused ? "play" : "pause"} size={1.5} white />
                        </button>

                        <div class="divider"></div>

                        <div class="time-section">
                            <span class="time">{joinTime(secondsToTime(Math.floor(displayTime)))}</span>
                            <input class="slider" type="range" min="0" max={Math.max(displayDuration || 1, 1)} step="1" value={displayTime} on:change={(e) => seekTo(Number(e.currentTarget.value))} />
                            <span class="time">{displayDuration > 0 ? joinTime(secondsToTime(Math.floor(displayDuration))) : "--:--"}</span>
                        </div>

                        <div class="divider"></div>

                        <button class="float-btn back-btn" on:click={() => seekRelative(-10)} title={translate("media.back10", $dictionary) || "Back 10s"}>
                            <Icon id="back_10" size={1.3} white />
                        </button>

                        <button class="float-btn forward-btn" on:click={() => seekRelative(10)} title={translate("media.forward10", $dictionary) || "Forward 10s"}>
                            <Icon id="forward_10" size={1.3} white />
                        </button>

                        <div class="divider"></div>

                        <button class="float-btn loop-btn" class:loop-on={isLooping} on:click={toggleLoop} title={translate("media._loop", $dictionary) || "Loop"}>
                            <Icon id="loop" size={1.3} white />
                        </button>

                        <button class="float-btn mute-btn" class:muted={!isMuted} on:click={toggleMute} title={translate(isMuted ? "actions.unmute" : "actions.mute", $dictionary) || "Mute"}>
                            <Icon id={isMuted ? "muted" : "volume"} size={1.3} white />
                        </button>
                    </div>
                </div>
            {:else}
                <!-- Entire preview becomes the play button when not playing -->
                <button class="media-click" on:click={playInOutput}>
                    {#if hasThumbnail}
                        <img src={thumbnailPath} alt="Preview" draggable="false" />
                    {:else}
                        <div class="placeholder">
                            <Icon id={mediaType === "player" ? "player" : "video"} size={2.5} />
                            <p>{translate("remote.no_preview", $dictionary) || "No preview available"}</p>
                            <small style="opacity: 0.6; word-break: break-all;">{path}</small>
                        </div>
                    {/if}
                    <div class="play-icon">
                        <Icon id="play" style="opacity: 0.8;" size={8} white />
                    </div>
                </button>

                <!-- Loop and mute options on the left (when not playing) -->
                {#if isVideo}
                    <div class="floating-controls left">
                        <div class="floating-bar">
                            <button class="float-btn loop-btn" class:loop-on={shouldLoop} on:click={toggleLoop} title={translate("media._loop", $dictionary) || "Loop"}>
                                <Icon id="loop" size={1.2} white />
                            </button>

                            <button class="float-btn mute-btn" class:muted={!shouldMute} on:click={toggleMute} title={translate(shouldMute ? "actions.unmute" : "actions.mute", $dictionary) || "Mute"}>
                                <Icon id={shouldMute ? "muted" : "volume"} size={1.2} white />
                            </button>
                        </div>
                    </div>
                {/if}
            {/if}
        {/if}
    </div>
{/if}

<style>
    .remote-media-page {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        color: var(--operator-text);
        background: var(--operator-canvas);
    }

    .remote-media-header {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--operator-border);
    }

    .browse-back,
    .remote-media-actions button {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 12px;
        border: 1px solid var(--operator-border);
        border-radius: 9px;
        color: var(--operator-text);
        background: var(--operator-raised);
        font: inherit;
        cursor: pointer;
    }

    .browse-back {
        align-self: flex-start;
        padding-inline: 8px 12px;
        border: 0;
        color: var(--operator-muted);
        background: transparent;
    }

    .remote-media-copy {
        min-width: 0;
    }

    .remote-media-copy h2 {
        overflow-wrap: anywhere;
        margin: 0;
        font-size: 1.12rem;
        line-height: 1.3;
    }

    .remote-media-copy p {
        overflow-wrap: anywhere;
        margin: 4px 0 0;
        color: var(--operator-muted);
        font-size: 0.9rem;
    }

    .connection-message,
    .launch-status,
    .launch-error,
    .thumbnail-error {
        margin: 0;
        padding: 10px 16px;
        color: var(--operator-text);
        background: var(--operator-surface);
        font-size: 0.9rem;
    }

    .launch-error {
        background: var(--operator-crimson);
    }

    .thumbnail-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .thumbnail-error button {
        flex: 0 0 auto;
        min-height: 44px;
        border: 1px solid var(--operator-border);
        border-radius: 8px;
        color: var(--operator-text);
        background: var(--operator-raised);
    }

    .remote-preview {
        position: relative;
        display: grid;
        flex: 1 0 auto;
        min-height: 180px;
        max-height: 52vh;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        place-items: center;
        background: var(--operator-surface);
    }

    .remote-preview img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .remote-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        max-width: 100%;
        padding: 24px;
        color: var(--operator-muted);
        text-align: center;
    }

    .remote-placeholder strong {
        max-width: 100%;
        overflow-wrap: anywhere;
        color: var(--operator-text);
        font-size: 1rem;
    }

    .live-label {
        position: absolute;
        top: 12px;
        left: 12px;
        padding: 6px 10px;
        border-radius: 6px;
        color: var(--operator-text);
        background: var(--operator-crimson);
        font-size: 0.88rem;
        font-weight: 600;
    }

    .remote-media-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 12px max(12px, env(safe-area-inset-bottom));
        background: var(--operator-surface);
    }

    .remote-media-actions button:disabled {
        cursor: default;
        opacity: 0.55;
    }

    .media-control-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .media-control-row button {
        flex: 1 1 calc(33.33% - 8px);
        min-width: 88px;
        padding-inline: 8px;
        font-size: 0.9rem;
    }

    .media-control-row .primary-control {
        border-color: transparent;
        color: var(--operator-canvas);
        background: var(--operator-amber);
        font-weight: 650;
    }

    .video-time-control {
        display: grid;
        grid-template-columns: 52px minmax(48px, 1fr) 52px;
        align-items: center;
        gap: 8px;
    }

    .video-time-control .time,
    .audio-time {
        color: var(--operator-muted);
        font-variant-numeric: tabular-nums;
        font-size: 0.88rem;
        text-align: center;
    }

    .video-time-control input {
        width: 100%;
        min-width: 0;
        height: 44px;
        margin: 0;
        accent-color: var(--operator-amber);
    }

    .audio-controls {
        align-items: center;
    }

    .audio-time {
        display: grid;
        min-width: 52px;
        min-height: 44px;
        place-items: center;
    }

    .audio-controls button {
        flex: 1;
    }

    .send-to-output {
        min-height: 52px !important;
        border-color: transparent !important;
        color: var(--operator-canvas) !important;
        background: var(--operator-amber) !important;
        font-weight: 700 !important;
    }

    .send-to-output :global(svg) {
        fill: currentColor;
    }

    @media (min-width: 760px) {
        .remote-media-header {
            flex-direction: row;
            align-items: center;
            gap: 20px;
            padding: 16px 24px;
        }

        .remote-preview {
            width: min(100%, 1000px);
            max-height: 56vh;
            align-self: center;
        }

        .remote-media-actions {
            width: min(100%, 1000px);
            align-self: center;
            padding-inline: 24px;
        }
    }

    .media {
        background-color: var(--primary-darker);
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;
    }

    img {
        object-fit: contain;
        width: 100%;
        height: 100%;
        flex: 1;
    }

    .placeholder {
        width: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: var(--text);
        text-align: center;
        padding: 16px;
        box-sizing: border-box;
        opacity: 0.8;
    }

    .media-click {
        position: relative;
        border: none;
        padding: 0;
        margin: 0;
        background: none;
        width: 100%;
        height: 100%;
        display: flex;
        cursor: pointer;
    }

    .media-click:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: -2px;
    }

    .play-icon {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 5;
        color: white;
    }

    /* Floating controls - similar to main app */
    .floating-controls {
        position: absolute;
        bottom: 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        z-index: 10;
    }

    .floating-controls.center {
        left: 50%;
        transform: translateX(-50%);
        width: 90%;
        max-width: 600px;
    }

    .floating-controls.left {
        left: 12px;
    }

    .floating-bar {
        display: flex;
        align-items: center;
        background-color: rgba(25, 25, 35, 0.85);
        backdrop-filter: blur(3px);
        border: 1px solid var(--primary-lighter);
        box-shadow: 1px 1px 6px rgb(0 0 0 / 0.4);
        border-radius: 40px;
        height: 44px;
        overflow: hidden;
    }

    .float-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0 14px;
        height: 100%;
        transition: background-color 0.15s;
    }

    /* Default all control icons to white */
    .float-btn :global(svg) {
        fill: white;
    }

    .float-btn:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .float-btn:active {
        background-color: rgba(255, 255, 255, 0.15);
    }

    .float-btn.play-pause {
        padding: 0 18px;
    }

    /* Play/Pause: white when paused (play icon), secondary when playing (pause icon) */
    .float-btn.play-pause:not(.paused) :global(svg) {
        fill: var(--accent);
    }

    .divider {
        width: 1px;
        height: 100%;
        background-color: var(--primary-lighter);
    }

    .time-section {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        flex: 1;
        min-width: 0;
    }

    .time {
        font-size: 0.75em;
        font-variant-numeric: tabular-nums;
        color: white;
        opacity: 0.9;
        min-width: 38px;
        text-align: center;
    }

    .slider {
        flex: 1;
        min-width: 60px;
        accent-color: var(--accent);
        height: 4px;
        cursor: pointer;
    }

    /* Loop button: white when off, secondary color when on */
    .float-btn.loop-btn.loop-on :global(svg) {
        fill: var(--accent);
    }

    /* Mute button: white when muted, secondary color when unmuted (has sound) */
    .float-btn.mute-btn.muted :global(svg) {
        fill: var(--accent);
    }

    @media (max-width: 768px) {
        .floating-controls {
            position: static;
            width: 100%;
            left: auto;
            transform: none;
            bottom: auto;
            align-items: stretch;
            padding: 0;
            margin-top: auto;
            box-sizing: border-box;
        }

        .floating-controls.center {
            width: 100%;
            max-width: none;
            left: auto;
            transform: none;
        }

        .floating-bar {
            width: 100%;
            box-shadow: none;
            border-radius: 12px 12px 0 0;
            border-left: none;
            border-right: none;
        }
    }

    /* Mobile: two-row layout, time/seek on top, controls below */
    @media (max-width: 768px) {
        .floating-bar {
            display: grid;
            grid-template-columns: repeat(5, minmax(44px, 1fr));
            grid-template-areas:
                "time time time time time"
                "play back forward loop mute";
            row-gap: 8px;
            column-gap: 8px;
            height: auto;
            padding: 10px 12px;
        }

        .divider {
            display: none;
        }

        .time-section {
            grid-area: time;
            width: 100%;
            padding: 0 4px;
            gap: 12px;
        }

        .float-btn {
            height: 36px;
            padding: 6px 10px;
            justify-self: center;
        }

        .float-btn.play-pause {
            grid-area: play;
            padding: 6px 12px;
        }

        .float-btn.back-btn {
            grid-area: back;
        }

        .float-btn.forward-btn {
            grid-area: forward;
        }

        .float-btn.loop-btn {
            grid-area: loop;
        }

        .float-btn.mute-btn {
            grid-area: mute;
        }

        .slider {
            min-width: 0;
        }
    }
</style>
