// ----- FreeShow -----
// Store-backed facade over the pure playback state reducer (#16).
//
// The canonical snapshots live in the main window (where the public REST
// handlers run). Output-window publishers send PLAYBACK_STATE messages over
// the OUTPUT channel; main-window publishers call publishPlaybackReport
// directly.

import { get, writable, type Unsubscriber } from "svelte/store"
import { OUTPUT } from "../../types/Channels"
import type { PlaybackSnapshot } from "./playbackState"
import { applyPlaybackReport, clearOutputPlayback, emptyPlaybackState, normalizePlaybackReport, type PlaybackStateMap } from "./playbackState"
import { outputs } from "../stores"
import { send } from "../utils/request"

const playbackState = writable<PlaybackStateMap>(emptyPlaybackState())

export function publishPlaybackReport(raw: any): void {
    const report = normalizePlaybackReport(raw)
    if (!report) return

    playbackState.update((state) => applyPlaybackReport(state, report))
}

export function clearPlaybackForOutput(outputId: string): void {
    if (!outputId) return
    playbackState.update((state) => clearOutputPlayback(state, outputId))
}

export function getPlaybackSnapshot(outputId: string): PlaybackSnapshot | undefined {
    return get(playbackState).snapshots[outputId]
}

export function subscribePlaybackState(run: (state: PlaybackStateMap) => void) {
    return playbackState.subscribe(run)
}

// output-window helper: publish a raw report over IPC to the main window
export function sendPlaybackReport(report: Record<string, any>): void {
    if (!report || !report.outputId) return
    send(OUTPUT, ["PLAYBACK_STATE"], report)
}

function isVideoBackground(background: any): boolean {
    if (!background) return false
    if (background.type === "video" || background.type === "player") return true
    const mediaPath = String(background.path || background.id || "")
    const extension = mediaPath.split(".").pop()?.toLowerCase() || ""
    return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(extension)
}

// clear canonical state when a video background is removed or replaced by non-video media.
// Returns an unsubscribe function; call once from the main window startup.
export function watchOutputBackgrounds(): Unsubscriber {
    let previous: Record<string, any> = {}
    return outputs.subscribe((nextOutputs) => {
        const next: Record<string, any> = nextOutputs || {}

        // skip the initial empty emission so pre-existing backgrounds are not cleared on boot
        if (!previous || !Object.keys(previous).length) {
            previous = next
            return
        }

        Object.keys({ ...previous, ...next }).forEach((outputId) => {
            const hadVideo = isVideoBackground(previous[outputId]?.out?.background)
            const stillOutput = !!next[outputId]
            const hasVideo = isVideoBackground(next[outputId]?.out?.background)
            if (hadVideo && (!stillOutput || !hasVideo)) clearPlaybackForOutput(outputId)
        })

        previous = next
    })
}
