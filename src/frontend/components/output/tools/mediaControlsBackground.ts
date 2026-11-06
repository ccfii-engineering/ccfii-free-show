import type { Output } from "../../../../types/Output"

// An operator toggle (loop) changes a flag of media that is already playing. Going through setOutput("background") would
// restart the background: after 600ms it re-sends the video data and the stored `startAt` (the video jumps back to 0).
// Patch the stored output instead; the running video gets the new flag through VideoPlayer.setLoop.
export function outputWithBackgroundFlag(output: Output, patch: { loop?: boolean; muted?: boolean }): Output {
    const background = output.out?.background
    if (!background) return output
    return { ...output, out: { ...output.out, background: { ...background, ...patch } } }
}
