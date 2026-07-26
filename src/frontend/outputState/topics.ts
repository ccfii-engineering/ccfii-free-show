import { get, type Readable } from "svelte/store"
import type { OutputStatePayloadByTopic, OutputStateTopic } from "../../types/OutputState"
import { AudioPlayer } from "../audio/audioPlayer"
import { activeProject, activeTimers, audioChannelsData, categories, colorbars, customMessageCredits, customMetadata, draw, drawSettings, drawTool, effects, equalizerConfig, events, gain, groups, language, livePrepare, media, metronome, metronomeTimer, outputSlideCache, overlays, playerVideos, playingAudio, projects, shows, showsCache, slideTimelineSpeedMultiplier, special, stageShows, styles, templates, timeFormat, timers, transitionData, variables, volume } from "../stores"

export type SharedOutputStateTopic = Exclude<OutputStateTopic, "output" | "mediaControlBaseline">

export interface OutputStateTopicSource<T extends SharedOutputStateTopic = SharedOutputStateTopic> {
    topic: T
    store: Readable<unknown>
    read: () => OutputStatePayloadByTopic[T]
}

function source<T extends SharedOutputStateTopic>(topic: T, store: Readable<OutputStatePayloadByTopic[T]>): OutputStateTopicSource<T> {
    return { topic, store, read: () => get(store) }
}

function derivedSource<T extends SharedOutputStateTopic>(topic: T, store: Readable<unknown>, read: () => OutputStatePayloadByTopic[T]): OutputStateTopicSource<T> {
    return { topic, store, read }
}

export const OUTPUT_STATE_TOPIC_SOURCES: OutputStateTopicSource[] = [
    source("language", language),
    source("styles", styles),
    source("transition", transitionData),
    source("shows", showsCache),
    source("categories", categories),
    source("templates", templates),
    source("overlays", overlays),
    source("events", events),
    source("groups", groups),
    source("draw", draw),
    source("drawTool", drawTool),
    source("drawSettings", drawSettings),
    source("media", media),
    source("outputSlideCache", outputSlideCache),
    source("effects", effects),
    source("timers", timers),
    source("activeTimers", activeTimers),
    source("variables", variables),
    source("timeFormat", timeFormat),
    source("special", special),
    source("slideTimelineSpeedMultiplier", slideTimelineSpeedMultiplier),
    source("playerVideos", playerVideos),
    source("stage", stageShows),
    source("projects", projects),
    source("activeProject", activeProject),
    source("showsData", shows),
    source("customMetadata", customMetadata),
    source("customCredits", customMessageCredits),
    source("volume", volume),
    source("gain", gain),
    source("audioChannelsData", audioChannelsData),
    source("equalizerConfig", equalizerConfig),
    source("metronome", metronome),
    source("metronomeTimer", metronomeTimer),
    derivedSource("playingAudio", playingAudio, () => AudioPlayer.getAllPlaying()),
    source("colorbars", colorbars),
    source("livePrepare", livePrepare)
]

export const OUTPUT_STATE_DEPENDENCY_TOPICS = OUTPUT_STATE_TOPIC_SOURCES.map(({ topic }) => topic)

const sourceByTopic = new Map(OUTPUT_STATE_TOPIC_SOURCES.map((entry) => [entry.topic, entry]))

export function getOutputStateTopicSource(topic: OutputStateTopic): OutputStateTopicSource | undefined {
    return sourceByTopic.get(topic as SharedOutputStateTopic)
}
