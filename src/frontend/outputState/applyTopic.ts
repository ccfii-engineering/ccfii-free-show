import { setEqualizerEnabled, updateEqualizerBands } from "../audio/audioEqualizer"
import {
    activeProject,
    activeTimers,
    audioChannelsData,
    categories,
    colorbars,
    customMessageCredits,
    customMetadata,
    draw,
    drawSettings,
    drawTool,
    effects,
    equalizerConfig,
    events,
    gain,
    groups,
    livePrepare,
    media,
    metronome,
    metronomeTimer,
    outputSlideCache,
    outputs,
    overlays,
    playerVideos,
    playingAudioPaths,
    projects,
    shows,
    showsCache,
    slideTimelineSpeedMultiplier,
    special,
    stageShows,
    styles,
    templates,
    timeFormat,
    timers,
    transitionData,
    variables,
    videosData,
    videosTime,
    volume
} from "../stores"
import { setLanguage } from "../utils/language"
import type { OutputTopicSnapshot } from "../../types/OutputState"

export async function applyOutputTopicSnapshot(snapshot: OutputTopicSnapshot, outputId: string): Promise<void> {
    const payload: any = snapshot.payload

    switch (snapshot.topic) {
        case "output":
            outputs.set({ [outputId]: payload })
            return
        case "language":
            setLanguage(payload)
            return
        case "styles":
            styles.set(payload)
            return
        case "transition":
            transitionData.set(payload)
            return
        case "shows":
            showsCache.set(payload)
            return
        case "categories":
            categories.set(payload)
            return
        case "templates":
            templates.set(payload)
            return
        case "overlays":
            overlays.set(payload)
            return
        case "events":
            events.set(payload)
            return
        case "groups":
            groups.set(payload)
            return
        case "draw":
            draw.set(payload)
            return
        case "drawTool":
            drawTool.set(payload)
            return
        case "drawSettings":
            drawSettings.set(payload)
            return
        case "media":
            media.set(payload)
            return
        case "outputSlideCache":
            outputSlideCache.set(payload)
            return
        case "effects":
            effects.set(payload)
            return
        case "timers":
            timers.set(payload)
            return
        case "activeTimers":
            activeTimers.set(payload)
            return
        case "variables":
            variables.set(payload)
            return
        case "timeFormat":
            timeFormat.set(payload)
            return
        case "special":
            special.set(payload)
            return
        case "slideTimelineSpeedMultiplier":
            slideTimelineSpeedMultiplier.set(payload)
            return
        case "playerVideos":
            playerVideos.set(payload)
            return
        case "stage":
            stageShows.set(payload)
            return
        case "projects":
            projects.set(payload)
            return
        case "activeProject":
            activeProject.set(payload)
            return
        case "showsData":
            shows.set(payload)
            return
        case "customMetadata":
            customMetadata.set(payload)
            return
        case "customCredits":
            customMessageCredits.set(payload)
            return
        case "volume":
            volume.set(payload)
            return
        case "gain":
            gain.set(payload)
            return
        case "audioChannelsData":
            audioChannelsData.set(payload)
            return
        case "equalizerConfig":
            equalizerConfig.set(payload)
            setEqualizerEnabled(payload.enabled)
            updateEqualizerBands(payload.bands)
            return
        case "metronome":
            metronome.set(payload)
            return
        case "metronomeTimer":
            metronomeTimer.set(payload)
            return
        case "playingAudio":
            playingAudioPaths.set(payload)
            return
        case "colorbars":
            colorbars.set(payload)
            return
        case "livePrepare":
            livePrepare.set(payload)
            return
        case "mediaControlBaseline":
            videosData.update((current) => ({ ...current, [outputId]: payload.videoData }))
            videosTime.update((current) => ({ ...current, [outputId]: payload.videoTime }))
            return
    }
}
