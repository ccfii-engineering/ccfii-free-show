// ----- FreeShow -----
// Playback command routing (#17): pause/resume/seek/mute commands are sent to
// whichever renderer owns the active Presentation Output. The owning renderer
// registers a command target for its outputId; outgoing generations
// unregister on destroy, so a command applied during a transition only ever
// reaches the incoming Render Generation.

import { OUTPUT } from "../../types/Channels"
import { send } from "../utils/request"

export interface PlaybackCommand {
    type: "pause" | "resume" | "seek" | "mute" | "unmute"
    time?: number // seek target in seconds
}

type PlaybackCommandTarget = (command: PlaybackCommand) => void

const commandTargets = new Map<string, PlaybackCommandTarget>()

export function registerPlaybackCommandTarget(outputId: string, target: PlaybackCommandTarget): () => void {
    commandTargets.set(outputId, target)
    return () => {
        if (commandTargets.get(outputId) === target) commandTargets.delete(outputId)
    }
}

// output-window side: apply an arriving command to the registered owner
export function handlePlaybackCommandMessage(payload: any): boolean {
    const outputId = typeof payload?.outputId === "string" ? payload.outputId : ""
    const type = payload?.type
    if (!outputId || !["pause", "resume", "seek", "mute", "unmute"].includes(type)) return false

    const target = commandTargets.get(outputId)
    if (!target) return false

    target({ type, time: Number.isFinite(Number(payload.time)) ? Number(payload.time) : undefined })
    return true
}

// the canonical generation prefix of GPU visual publishers (see playbackStore publishers)
export function isGpuGeneration(generation: unknown): boolean {
    return typeof generation === "string" && generation.startsWith("gpu-")
}

// main-window side: route a command over IPC to the owning output window
export function sendPlaybackCommand(outputId: string, command: PlaybackCommand): void {
    if (!outputId) return
    send(OUTPUT, ["PLAYBACK_COMMAND"], { outputId, ...command })
}
