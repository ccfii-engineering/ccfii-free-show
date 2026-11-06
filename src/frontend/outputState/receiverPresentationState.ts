// Presentation State rules for the OUTPUT receiver (#73). Pure and store-free: the receiver reads
// the stores, passes plain values in, and applies the result. See CONTEXT.md "Presentation State".

type OutputsMap = Record<string, any>
export type OutputActiveState = { id: string; active: boolean | "invisible" }

function liveBackground(outputs: OutputsMap, id: string) {
    const background = outputs[id]?.out?.background
    return background && (background.path || background.id) ? background : null
}

// Late MAIN_DATA/MAIN_TIME messages can arrive after a background was cleared (IPC race with
// clearBackground's store cleanup) and resurrect stale duration/progress (#16/#18). Drop updates
// for outputs that no longer have a live background.
export function filterLiveBackgroundUpdates(msg: any, outputs: OutputsMap): Record<string, any> | null {
    if (!msg || typeof msg !== "object") return null
    const filtered: Record<string, any> = {}
    let kept = false
    for (const [outputId, value] of Object.entries(msg)) {
        if (!liveBackground(outputs, outputId)) continue
        filtered[outputId] = value
        kept = true
    }
    return kept ? filtered : null
}

// An output that stops being active must not keep media state alive (#19): a stale background
// re-opens misrouted into the legacy playback path because the canonical generation was retired.
export function outputsToClearOnDeactivate(newStates: OutputActiveState[], outputs: OutputsMap): string[] {
    return newStates.filter((state) => state.active === false && outputs[state.id]?.out?.background).map((state) => state.id)
}

// Merge reported output states into the tracked list. Only enabled, visible outputs are kept; the
// display state is set (non-undefined) only when every boolean state agrees.
export function mergeOutputStates(current: OutputActiveState[], newStates: OutputActiveState[], outputs: OutputsMap): { states: OutputActiveState[]; display: boolean | undefined } {
    const merged = [...current]
    newStates.forEach((newState) => {
        const index = merged.findIndex((state) => state.id === newState.id)
        if (index < 0) merged.push(newState)
        else merged[index] = newState
    })

    const states = merged.filter((state) => outputs[state.id]?.enabled && !outputs[state.id]?.invisible)

    const visible = [...new Set(states.filter((state) => typeof state.active === "boolean").map((state) => state.active as boolean))]
    return { states, display: visible.length === 1 ? visible[0] : undefined }
}

// Track playing output videos from audio reports: stop removes, existing entries update, new
// entries are added only while the output still has a background.
export function applyPlayingVideoAudio(playing: any[], data: any, outputs: OutputsMap): any[] {
    const next = [...playing]
    const existing = next.findIndex((a) => a.id === data.id)

    if (data.stop) {
        if (existing > -1) next.splice(existing, 1)
        return next
    }

    if (existing > -1) next[existing] = { ...data, location: "output" }
    else if (outputs[data.id]?.out?.background) next.push({ location: "output", ...data })
    return next
}
