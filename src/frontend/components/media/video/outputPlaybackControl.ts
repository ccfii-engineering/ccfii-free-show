type OutputBackgroundIdentity = {
    path?: string
    id?: string
    loop?: boolean
    muted?: boolean
}

type OutputBackgroundMap = Record<string, { out?: { background?: OutputBackgroundIdentity } } | undefined>
export type LinkedVideoEntry = { path: string; linkedOutputIds: string[]; type?: "background" | "item" }

export type PlaybackSelection<T extends LinkedVideoEntry = LinkedVideoEntry> = {
    identity: string
    requestedOutputId?: string
    entry: T | null
    linkedOutputIds: string[]
    currentBackground?: OutputBackgroundIdentity
    type: "background" | "item"
}

type PlaybackControlDependencies<T extends LinkedVideoEntry> = {
    getEntries: () => T[]
    getOutputs: () => OutputBackgroundMap
    send: (type: "DATA" | "TIME", message: Record<string, any>) => void
}

export function matchesOutputBackground(identity: string, background?: OutputBackgroundIdentity | null): boolean {
    return !!identity && (background?.path || background?.id) === identity
}

export function getMatchingLinkedOutputs(identity: string, linkedOutputIds: string[], outputs: OutputBackgroundMap): string[] {
    return linkedOutputIds.filter((outputId) => matchesOutputBackground(identity, outputs[outputId]?.out?.background))
}

export function findPlayingEntry<T extends LinkedVideoEntry>(entries: T[], identity: string, outputIds?: string[]): T | null {
    return entries.find((entry) => entry.path === identity && (!outputIds?.length || outputIds.some((outputId) => entry.linkedOutputIds.includes(outputId)))) || null
}

export function resolveOutputPaused(requestedPaused: boolean | undefined, audioPaused: boolean): boolean {
    return requestedPaused === undefined ? audioPaused : requestedPaused
}

export function mergeOutputVideoData<T extends Record<string, any>>(current: T, message: Record<string, any> | null | undefined, identity: string): (T & Record<string, any>) | null {
    if (!message || typeof message !== "object") return null
    if (typeof message.identity === "string" && message.identity !== identity) return null

    const { identity: _identity, ...updates } = message
    return { ...current, ...updates }
}

export function readOutputVideoTime(message: unknown, identity: string): number | undefined {
    if (typeof message === "number") return Number.isFinite(message) ? message : undefined
    if (!message || typeof message !== "object") return undefined

    const control = message as { identity?: unknown; time?: unknown }
    if (typeof control.identity === "string" && control.identity !== identity) return undefined

    return typeof control.time === "number" && Number.isFinite(control.time) ? control.time : undefined
}

export function makeOutputVideoData(identity: string, data: Record<string, any>): Record<string, any> {
    return { identity, ...data }
}

export function makeOutputVideoTime(identity: string, time: number): { identity: string; time: number } {
    return { identity, time }
}

export class OutputPlaybackControl<T extends LinkedVideoEntry = LinkedVideoEntry> {
    private readonly dependencies: PlaybackControlDependencies<T>

    constructor(dependencies: PlaybackControlDependencies<T>) {
        this.dependencies = dependencies
    }

    isCurrentBackground(identity: string, outputId: string): boolean {
        return matchesOutputBackground(identity, this.dependencies.getOutputs()[outputId]?.out?.background)
    }

    select(identity: string, requestedOutputId?: string): PlaybackSelection<T> | null {
        const entries = this.dependencies.getEntries()
        const outputs = this.dependencies.getOutputs()
        const entry = findPlayingEntry(entries, identity, requestedOutputId ? [requestedOutputId] : undefined)
        const currentBackground = requestedOutputId ? outputs[requestedOutputId]?.out?.background : undefined

        if (requestedOutputId) {
            // Timeline items keep their existing audio ownership. Background controls
            // must still target the media currently shown by the requested output.
            if (entry?.type === "item") return this.makeSelection(identity, requestedOutputId, entry, currentBackground)
            if (!matchesOutputBackground(identity, currentBackground)) return null
            return this.makeSelection(identity, requestedOutputId, entry, currentBackground)
        }

        if (!entry) return null
        return this.makeSelection(identity, undefined, entry)
    }

    execute(identity: string, requestedOutputId: string | undefined, command: (selection: PlaybackSelection<T>) => void): boolean {
        const selection = this.select(identity, requestedOutputId)
        if (!selection) return false

        command(selection)
        return true
    }

    isCurrentEntry(entry: T, expectedOutputIds: string[]): boolean {
        if (!this.dependencies.getEntries().includes(entry)) return false
        if (entry.type === "item") return true

        const outputs = this.dependencies.getOutputs()
        if (!expectedOutputIds.length && !entry.linkedOutputIds.length) return true

        const requested = expectedOutputIds.length ? expectedOutputIds : entry.linkedOutputIds
        const candidates = requested.filter((outputId) => !entry.linkedOutputIds.length || entry.linkedOutputIds.includes(outputId))
        return candidates.some((outputId) => matchesOutputBackground(entry.path, outputs[outputId]?.out?.background))
    }

    getCurrentLinkedOutputIds(identity: string, linkedOutputIds: string[]): string[] {
        return getMatchingLinkedOutputs(identity, linkedOutputIds, this.dependencies.getOutputs())
    }

    selectEntry(entry: T): PlaybackSelection<T> | null {
        if (!this.dependencies.getEntries().includes(entry)) return null
        return this.makeSelection(entry.path, undefined, entry)
    }

    publishData(selection: PlaybackSelection<T>, data: Record<string, any>, targetOutputIds?: string[]): void {
        if (selection.type === "item") return
        if (selection.entry && !this.dependencies.getEntries().includes(selection.entry)) return

        const outputIds = targetOutputIds || (selection.entry ? selection.linkedOutputIds : selection.requestedOutputId ? [selection.requestedOutputId] : [])
        const message: Record<string, any> = {}
        outputIds.forEach((outputId) => {
            if (!this.isCurrentBackground(selection.identity, outputId)) return
            message[outputId] = makeOutputVideoData(selection.identity, data)
        })
        if (Object.keys(message).length) this.dependencies.send("DATA", message)
    }

    publishTime(selection: PlaybackSelection<T>, time: number): void {
        if (selection.type === "item") return
        if (selection.entry && !this.dependencies.getEntries().includes(selection.entry)) return

        const outputIds = selection.entry ? selection.linkedOutputIds : selection.requestedOutputId ? [selection.requestedOutputId] : []
        const message: Record<string, any> = {}
        outputIds.forEach((outputId) => {
            if (!this.isCurrentBackground(selection.identity, outputId)) return
            message[outputId] = makeOutputVideoTime(selection.identity, time)
        })
        if (Object.keys(message).length) this.dependencies.send("TIME", message)
    }

    private makeSelection(identity: string, requestedOutputId: string | undefined, entry: T | null, currentBackground?: OutputBackgroundIdentity): PlaybackSelection<T> {
        return {
            identity,
            requestedOutputId,
            entry,
            linkedOutputIds: entry ? [...entry.linkedOutputIds] : requestedOutputId ? [requestedOutputId] : [],
            currentBackground,
            type: entry?.type || "background"
        }
    }
}
