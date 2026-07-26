import type { OutputStateDependencies, OutputStatePayloadByTopic, OutputStateScope, OutputStateTopic, OutputTopicSnapshot } from "../../types/OutputState"

export const OUTPUT_STATE_PROTOCOL_VERSION = 1 as const
export const OUTPUT_STATE_TOPICS = [
    "output",
    "language",
    "styles",
    "transition",
    "shows",
    "categories",
    "templates",
    "overlays",
    "events",
    "groups",
    "draw",
    "drawTool",
    "drawSettings",
    "media",
    "outputSlideCache",
    "effects",
    "timers",
    "activeTimers",
    "variables",
    "timeFormat",
    "special",
    "slideTimelineSpeedMultiplier",
    "playerVideos",
    "stage",
    "projects",
    "activeProject",
    "showsData",
    "customMetadata",
    "customCredits",
    "volume",
    "gain",
    "audioChannelsData",
    "equalizerConfig",
    "metronome",
    "metronomeTimer",
    "playingAudio",
    "colorbars",
    "livePrepare",
    "mediaControlBaseline"
] as const

const OMIT = Symbol("omit")
const outputScopedTopics = new Set<OutputStateTopic>(["output", "mediaControlBaseline"])

export function outputStateKey(topic: OutputStateTopic, scope: OutputStateScope): string {
    return scope.kind === "shared" ? `${topic}:shared` : `${topic}:${scope.outputId}`
}

export function canonicalizeOutputState(value: unknown): string {
    const active = new Set<object>()
    const normalized = normalize(value, active, false)
    if (normalized === OMIT) throw new TypeError("Output state cannot be undefined")
    return JSON.stringify(normalized)
}

export function hashOutputStatePayload(value: unknown): string {
    const canonical = canonicalizeOutputState(value)
    let hash = 0x811c9dc5

    for (let i = 0; i < canonical.length; i++) {
        hash ^= canonical.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }

    return (hash >>> 0).toString(16).padStart(8, "0")
}

export function createOutputTopicSnapshot<T extends OutputStateTopic>(topic: T, scope: OutputStateScope, revision: number, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies): OutputTopicSnapshot<T> {
    const identity = { protocolVersion: OUTPUT_STATE_PROTOCOL_VERSION, topic, scope, revision, dependencies, payload }
    return { ...identity, contentHash: hashOutputStatePayload(identity) }
}

export function isOutputTopicSnapshot(value: unknown): value is OutputTopicSnapshot {
    if (!isRecord(value)) return false
    if (value.protocolVersion !== OUTPUT_STATE_PROTOCOL_VERSION) return false
    if (!OUTPUT_STATE_TOPICS.includes(value.topic as OutputStateTopic)) return false
    if (!isValidScope(value.scope)) return false
    if (!Number.isInteger(value.revision) || (value.revision as number) <= 0) return false
    if (typeof value.contentHash !== "string" || !value.contentHash.length) return false
    if (!isValidDependencies(value.dependencies)) return false

    const topic = value.topic as OutputStateTopic
    const scope = value.scope as OutputStateScope
    if (outputScopedTopics.has(topic) !== (scope.kind === "output")) return false

    try {
        canonicalizeOutputState(value.payload)
    } catch {
        return false
    }

    return true
}

export function isValidOutputTopicSnapshot(value: unknown): value is OutputTopicSnapshot {
    if (!isOutputTopicSnapshot(value)) return false
    const identity = { protocolVersion: value.protocolVersion, topic: value.topic, scope: value.scope, revision: value.revision, dependencies: value.dependencies, payload: value.payload }
    return value.contentHash === hashOutputStatePayload(identity)
}

function normalize(value: unknown, active: Set<object>, inArray: boolean): unknown | typeof OMIT {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("Output state numbers must be finite")
        return value
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol") return inArray ? null : OMIT
    if (typeof value === "bigint") throw new TypeError("Output state cannot contain bigint values")
    if (typeof value !== "object") throw new TypeError("Output state contains an unsupported value")

    if (active.has(value)) throw new TypeError("Output state cannot contain cyclic values")
    active.add(value)

    try {
        if (value instanceof Date) return value.toISOString()
        if (Array.isArray(value)) return value.map((item) => normalize(item, active, true))

        const result: Record<string, unknown> = {}
        Object.keys(value as object)
            .sort()
            .forEach((key) => {
                const normalized = normalize((value as Record<string, unknown>)[key], active, false)
                if (normalized !== OMIT) result[key] = normalized
            })
        return result
    } finally {
        active.delete(value)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function isValidScope(value: unknown): value is OutputStateScope {
    if (!isRecord(value)) return false
    if (value.kind === "shared") return Object.keys(value).length === 1
    return value.kind === "output" && typeof value.outputId === "string" && !!value.outputId
}

function isValidDependencies(value: unknown): value is OutputStateDependencies | undefined {
    if (value === undefined) return true
    if (!isRecord(value)) return false
    return Object.values(value).every((revision) => Number.isInteger(revision) && (revision as number) > 0)
}
