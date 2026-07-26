import type { Output } from "./Output"
import type { OUTPUT_STATE_PROTOCOL_VERSION, OUTPUT_STATE_TOPICS } from "../common/outputState/snapshot"

export type OutputStateTopic = (typeof OUTPUT_STATE_TOPICS)[number]
export type OutputPresentationMode = "live" | "cleared"
export type OutputStateScope = { kind: "shared" } | { kind: "output"; outputId: string }
export type OutputStateDependencies = Record<string, number>

export type OutputStatePayloadByTopic = {
    output: Output
    language: string
    styles: unknown
    transition: unknown
    shows: unknown
    categories: unknown
    templates: unknown
    overlays: unknown
    events: unknown
    groups: unknown
    draw: unknown
    drawTool: unknown
    drawSettings: unknown
    media: unknown
    outputSlideCache: unknown
    effects: unknown
    timers: unknown
    activeTimers: unknown
    variables: unknown
    timeFormat: unknown
    special: unknown
    slideTimelineSpeedMultiplier: number
    playerVideos: unknown
    stage: unknown
    projects: unknown
    activeProject: unknown
    showsData: unknown
    customMetadata: unknown
    customCredits: string
    volume: number
    gain: number
    audioChannelsData: unknown
    equalizerConfig: unknown
    metronome: unknown
    metronomeTimer: unknown
    playingAudio: string[]
    colorbars: unknown
    livePrepare: unknown
    mediaControlBaseline: unknown
}

export interface OutputTopicSnapshot<T extends OutputStateTopic = OutputStateTopic> {
    protocolVersion: typeof OUTPUT_STATE_PROTOCOL_VERSION
    topic: T
    scope: OutputStateScope
    revision: number
    contentHash: string
    dependencies?: OutputStateDependencies
    payload: OutputStatePayloadByTopic[T]
}

export interface OutputStateManifestEntry {
    topic: OutputStateTopic
    scope: OutputStateScope
    revision: number
    contentHash: string
}

export interface OutputStateReady {
    outputId: string
    sessionId: string
    protocolVersion: number
}

export interface OutputStateManifest {
    outputId: string
    sessionId: string
    protocolVersion: typeof OUTPUT_STATE_PROTOCOL_VERSION
    entries: OutputStateManifestEntry[]
}

export interface OutputStateApply {
    outputId: string
    sessionId: string
    snapshot: OutputTopicSnapshot
}

export interface OutputStateObservation {
    outputId: string
    sessionId: string
    topic: OutputStateTopic
    scope: OutputStateScope
    revision: number
    contentHash: string
}

export type OutputStateRejectionReason = "unsupported_protocol" | "invalid_snapshot" | "wrong_output" | "wrong_session" | "stale_revision" | "hash_mismatch" | "sender_output_mismatch" | "missing_dependency"

export interface OutputStateRejection extends OutputStateObservation {
    reason: OutputStateRejectionReason
}

export type OutputStateHealthStatus = "syncing" | "healthy" | "retrying" | "recovering" | "unhealthy" | "render_failed"

export interface OutputStateHealth {
    outputId: string
    sessionId: string
    status: OutputStateHealthStatus
    topic?: OutputStateTopic
    revision?: number
    retryCount?: number
    reason?: string
}

export interface OutputStateNeeded {
    keys: { topic: OutputStateTopic; scope: OutputStateScope }[]
}

export interface OutputStateRendered extends OutputStateObservation {
    status: "rendered" | "render_failed"
    failures?: { layer: string; reason: string }[]
}

export type OutputStateToRendererMessage = { channel: "OUTPUT_STATE_MANIFEST"; data: OutputStateManifest } | { channel: "OUTPUT_STATE_APPLY"; data: OutputStateApply }
export type OutputStateToMainMessage = { channel: "OUTPUT_STATE_NEEDED"; data: OutputStateNeeded } | { channel: "OUTPUT_STATE_HEALTH"; data: OutputStateHealth }
