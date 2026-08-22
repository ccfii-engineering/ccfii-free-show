// ----- FreeShow -----
// Canonical per-output media playback state (#14/#16).
//
// One snapshot per Presentation Output, published by the active Render
// Generation's visual source (GPU hidden video element or the DOM video) and
// optionally enriched by sync publishers (the legacy VideoPlayer audio clock).
// Outgoing sources are tombstoned so a destroyed renderer can never republish;
// clearing media retires the current owner and drops its late reports.

export type PlaybackRole = "visual" | "sync"

export interface PlaybackReport {
    outputId: string
    sourceId: string
    role: PlaybackRole
    identity?: string
    duration?: number
    progress?: number
    paused?: boolean
    loop?: boolean
    muted?: boolean
    event?: "wrap" | "ended"
}

export interface PlaybackSnapshot {
    identity: string
    duration: number
    progress: number
    paused: boolean
    loop: boolean
    muted: boolean
    generation: string
    lastWrapAt: number | null
    updatedAt: number
}

export interface PlaybackStateMap {
    snapshots: { [outputId: string]: PlaybackSnapshot }
    activeVisual: { [outputId: string]: string }
    retired: { [outputId: string]: string[] }
}

const PLAYBACK_EVENTS = new Set(["wrap", "ended"])

export function emptyPlaybackState(): PlaybackStateMap {
    return { snapshots: {}, activeVisual: {}, retired: {} }
}

export function normalizePlaybackReport(raw: any): PlaybackReport | null {
    if (!raw || typeof raw !== "object") return null

    const outputId = typeof raw.outputId === "string" ? raw.outputId : ""
    const sourceId = typeof raw.sourceId === "string" ? raw.sourceId : ""
    const role: PlaybackRole = raw.role === "visual" || raw.role === "sync" ? raw.role : ("" as PlaybackRole)
    if (!outputId || !sourceId || !role) return null

    return {
        outputId,
        sourceId,
        role,
        identity: typeof raw.identity === "string" && raw.identity ? raw.identity : undefined,
        duration: toFiniteNumber(raw.duration),
        progress: toFiniteNumber(raw.progress),
        paused: toBoolean(raw.paused),
        loop: toBoolean(raw.loop),
        muted: toBoolean(raw.muted),
        event: PLAYBACK_EVENTS.has(raw.event) ? raw.event : undefined
    }
}

export function applyPlaybackReport(state: PlaybackStateMap, report: PlaybackReport, now: number = Date.now()): PlaybackStateMap {
    if (state.retired[report.outputId]?.includes(report.sourceId)) return state

    const snapshot = state.snapshots[report.outputId]

    if (report.role === "sync") {
        if (!snapshot) return state
        // protect against cross-media bleed during transitions
        if (snapshot.identity && report.identity && snapshot.identity !== report.identity) return state
        return mergeReport(state, report, now)
    }

    if (state.activeVisual[report.outputId] !== report.sourceId) {
        // a different visual source is claiming this output: an authoritative ownership transfer,
        // so any previous identity no longer applies
        const previousSource = state.activeVisual[report.outputId]
        state = retire(state, report.outputId, previousSource)
        const fresh: PlaybackSnapshot = {
            identity: report.identity || "",
            duration: report.duration ?? 0,
            progress: report.progress ?? 0,
            paused: report.paused ?? false,
            loop: report.loop ?? false,
            muted: report.muted ?? true,
            generation: report.sourceId,
            lastWrapAt: report.event === "wrap" ? now : null,
            updatedAt: now
        }
        return {
            ...state,
            snapshots: { ...state.snapshots, [report.outputId]: fresh },
            activeVisual: { ...state.activeVisual, [report.outputId]: report.sourceId }
        }
    }

    return mergeReport(state, report, now)
}

export function clearOutputPlayback(state: PlaybackStateMap, outputId: string): PlaybackStateMap {
    const withRetiredOwner = retire(state, outputId, state.activeVisual[outputId])
    if (!withRetiredOwner.snapshots[outputId]) return withRetiredOwner

    const snapshots = { ...withRetiredOwner.snapshots }
    delete snapshots[outputId]
    return { ...withRetiredOwner, snapshots }
}

function mergeReport(state: PlaybackStateMap, report: PlaybackReport, now: number): PlaybackStateMap {
    const current = state.snapshots[report.outputId]
    if (!current) return state

    const next: PlaybackSnapshot = {
        ...current,
        duration: report.duration ?? current.duration,
        progress: report.progress ?? current.progress,
        paused: report.paused ?? current.paused,
        loop: report.loop ?? current.loop,
        muted: report.muted ?? current.muted,
        updatedAt: now
    }
    if (report.identity && !current.identity) next.identity = report.identity
    if (report.event === "wrap") {
        next.progress = report.progress ?? 0
        next.lastWrapAt = now
    }

    return { ...state, snapshots: { ...state.snapshots, [report.outputId]: next } }
}

function retire(state: PlaybackStateMap, outputId: string, sourceId: string | undefined): PlaybackStateMap {
    if (!sourceId) return state
    const retiredList = state.retired[outputId] || []
    if (retiredList.includes(sourceId)) return state

    const nextActive = { ...state.activeVisual }
    delete nextActive[outputId]
    return {
        ...state,
        activeVisual: nextActive,
        retired: { ...state.retired, [outputId]: [...retiredList, sourceId] }
    }
}

function toFiniteNumber(value: any): number | undefined {
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
}

function toBoolean(value: any): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}
