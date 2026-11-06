import type { Event } from "../Calendar"
import type { MediaStyle, Variable } from "../Main"
import type { Output } from "../Output"
import type { OutSlide, Show, Timer } from "../Show"
import type { StageLayout } from "../Stage"
import type { WebProtocolDef } from "../WebProtocol"

// Web Control Protocol for Stage (same pattern as ../remote/protocol.ts).
//
// StageResponses  channel -> payload for every message the main app sends to the Stage web app.
// StageProtocol   request key -> { request payload, reply channels } for every message the Stage sends.
// The Stage web app (src/server/stage) and the main app (src/frontend/utils/stageTalk.ts, sendData.ts) import this file.

export interface StageLayoutEntry {
    id: string
    name: string
    password: boolean
}
/** a layout as sent to a client: the selected stage layout plus its id and display labels */
export type StageLayoutData = StageLayout & { id?: string }
/** "noShow": layout missing or disabled, "wrongPass": password rejected */
export type StageError = "noShow" | "wrongPass" | (string & {})

export interface StageLayoutRequest {
    id: string
    password?: string
}
export interface StageOutRequest {
    /** stage layout id; defaults to the layout this connection opened */
    id?: string
}
export interface StageProgressRequest {
    outputId?: string
}
/** REQUEST_PROGRESS is echoed back with the progress attached */
export interface StageProgress extends StageProgressRequest {
    progress?: {
        currentShowSlide: number
        slidesLength: number
        layoutGroups: { name?: string; oneLetterName?: string; index?: number; child?: number; hide?: boolean }[]
        projectItems: unknown[]
        currentProjectIndexes: unknown
    }
}
export interface StageStreamRequest {
    outputId?: string
}
export interface StageActionRequest {
    id: string
}

/** last slide per output id, kept so a cleared output can resume from its previous position */
export type StageOutSlideCache = { [outputId: string]: OutSlide }
/** a background (or the upcoming one) with its media style; `path` is a base64 thumbnail, `filePath` the original path */
export interface StageBackgroundRef {
    path?: string
    filePath?: string
    mediaStyle?: MediaStyle
}
/** `next` and `next2` are `{}` when there is no upcoming slide background */
export interface StageBackground extends StageBackgroundRef {
    next?: StageBackgroundRef
    next2?: StageBackgroundRef
}
/** a running global timer: the timer definition plus its live state */
export type StageActiveTimer = Timer & { id: string; currentTime?: number; paused?: boolean; startTime?: number }

export interface StageResponses {
    LAYOUTS: StageLayoutEntry[]
    LAYOUT: StageLayoutData
    ERROR: StageError
    SWITCH: { id: string }
    OUT: Output
    OUT_SLIDE_CACHE: StageOutSlideCache
    BACKGROUND: StageBackground
    MEDIA: { path: string; value: string }
    SHOW_DATA: { id: string; show: Show }
    EVENTS: { [id: string]: Event }
    TIMERS: { [id: string]: Timer }
    VARIABLES: { [id: string]: Variable }
    ACTIVE_TIMERS: { [id: string]: Timer }[]
    REQUEST_PROGRESS: StageProgress
    DATA: { timeFormat?: "12" | "24" }
    /** push-driven frames, keyed per output id by the client */
    STREAM_FRAME: { id?: string; jpeg?: string; size?: unknown }
    LANGUAGE: { strings: { [section: string]: { [key: string]: string } | undefined } }
}
export type StageResponseKey = keyof StageResponses

type Reply<K extends StageResponseKey> = Pick<StageResponses, K>
type NoReply = Record<never, never>

export interface StageProtocol {
    LAYOUTS: { request: null; replies: Reply<"LAYOUTS"> }
    LAYOUT: { request: StageLayoutRequest; replies: Reply<"LAYOUT" | "ERROR"> }
    OUT: { request: StageOutRequest | null; replies: Reply<"OUT"> }
    SHOW_DATA: { request: null; replies: Reply<"SHOW_DATA"> }
    REQUEST_PROGRESS: { request: StageProgressRequest; replies: Reply<"REQUEST_PROGRESS"> }
    STREAM_SUBSCRIBE: { request: StageStreamRequest | null; replies: NoReply }
    STREAM_UNSUBSCRIBE: { request: null; replies: NoReply }
    RUN_ACTION: { request: StageActionRequest; replies: NoReply }
}
export type StageRequestKey = keyof StageProtocol & string

/** Compile-time exhaustive: adding a key to StageProtocol without listing it here fails to type-check. */
const STAGE_REQUEST_KEY_MAP: { [K in StageRequestKey]: true } = {
    LAYOUTS: true,
    LAYOUT: true,
    OUT: true,
    SHOW_DATA: true,
    REQUEST_PROGRESS: true,
    STREAM_SUBSCRIBE: true,
    STREAM_UNSUBSCRIBE: true,
    RUN_ACTION: true
}
export const STAGE_REQUEST_KEYS = Object.keys(STAGE_REQUEST_KEY_MAP) as StageRequestKey[]
export function isStageRequestKey(channel: string): channel is StageRequestKey {
    return Object.prototype.hasOwnProperty.call(STAGE_REQUEST_KEY_MAP, channel)
}

/**
 * Data requests the Stage re-issues after a reconnect, once its layout is open again. All three are side-effect-free
 * reads on the main app (they only push data to the asking client; no operator state changes). LAYOUT is not replayed:
 * the Stage reopens its layout through LAYOUTS, and RUN_ACTION / STREAM_* are live actions.
 */
export const STAGE_REPLAY_KEYS: readonly string[] = ["OUT", "SHOW_DATA", "REQUEST_PROGRESS"]
export function toStageReplayRequest(channel: string, data: unknown): { channel: StageRequestKey; data: unknown } | null {
    return STAGE_REPLAY_KEYS.includes(channel) ? { channel: channel as StageRequestKey, data } : null
}

/** Compile-time check that StageProtocol satisfies the generic protocol constraint. */
export type StageProtocolCheck = WebProtocolDef<StageProtocol>
