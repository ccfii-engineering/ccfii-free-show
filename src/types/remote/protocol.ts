import type { Variable } from "../Main"
import type { OutData } from "../Output"
import type { Project } from "../Projects"
import type { AspectRatio, Dictionary, Resolution } from "../Settings"
import type { Action, OutSlide, Overlays, Show, Tag, Templates, Timer, TrimmedShows } from "../Show"
import type { BibleCategories, Categories } from "../Tabs"
import type { WebProtocolDef } from "../WebProtocol"
import type { RemoteMediaErrorCode, RemoteMediaPage, RemoteMediaPageRequest, RemoteMediaPlayRequest } from "./control"

// Web Control Protocol for Remote.
//
// RemoteResponses  channel -> payload for every message the main app sends to the Remote web app.
// RemoteProtocol   request key -> { request payload, reply channels } for every message the Remote sends.
// The Remote web app (src/server/remote) and the main app (src/frontend/utils/remoteTalk.ts, sendData.ts)
// both import this file. Generic helpers live in ../WebProtocol so Stage and Controller can reuse them.

// ---- payload shapes -------------------------------------------------------------------------------------

export type RemoteShow = Show & { id: string }
export type RemoteProject = Project & { id: string }

export interface RemotePasswordInfo {
    dictionary: Dictionary
    password: boolean
}

/** current output state (slide mode) */
export interface RemoteOutSlide {
    slide: number | null
    layout: string | null
    styleRes: AspectRatio | Resolution | null
    show?: RemoteShow
}
/** current output state when a temporary slide (e.g. scripture) is showing */
export type RemoteOutTemp = OutSlide & { id: "temp" }
/** show a slide by index (current show), by show id and index, or clear; `null` asks for the current state */
export type RemoteOutRequest = "clear" | number | { id: string; index: number; layout?: string } | null

export interface RemoteScriptureRequest {
    id: string
    bookKey?: number
    chapterKey?: number
    bookIndex?: number
    chapterIndex?: number
}
export interface RemoteScriptureChaptersUpdate {
    kind: "chapters"
    id: string
    bookIndex?: number
    chapters: { number: number; keyName: number }[]
}
export interface RemoteScriptureVersesUpdate {
    kind: "verses"
    id: string
    bookIndex?: number
    chapterIndex?: number
    verses: { number: number; text: string; keyName: number }[]
}
export interface RemoteScriptureResponse extends RemoteScriptureRequest {
    /** full bible (local) or its book list (API bibles) */
    bible?: { books: unknown[] }
    bibleUpdate?: RemoteScriptureChaptersUpdate | RemoteScriptureVersesUpdate
}
export interface RemoteScriptureSearchRequest {
    id: string
    searchTerm: string
    searchType?: "reference" | "text"
    bookFilter?: string | number
}
export interface RemoteScriptureSearchResponse extends RemoteScriptureSearchRequest {
    /** `null` means the Remote searches its cached local bible */
    searchResults: { type: string; [key: string]: unknown } | null
}

/** an entry of the show media map the Remote scans for audio files */
export interface RemoteMediaSource {
    type?: string
    name?: string
    path?: string
    audioPath?: string
    [key: string]: unknown
}

/** the scripture open in the main app; the Remote reads `api`, `bible` or the object itself */
export interface RemoteActiveScripture {
    api?: { [key: string]: unknown }
    bible?: { [key: string]: unknown }
    [key: string]: unknown
}

export interface RemoteFunctions {
    actions: { [key: string]: Action }
    actionTags: { [key: string]: Tag }
    variables: { [key: string]: Variable }
    variableTags: { [key: string]: Tag }
    timers: { [key: string]: Timer }
    /** not sent by the main app today; the Remote store accepts it */
    timerTags?: { [key: string]: Tag }
    activeTimers: unknown[]
    runningActions: string[]
}

export interface RemoteMediaError {
    requestId: string
    code: RemoteMediaErrorCode
}
export interface RemoteMediaThumbnailRequestMessage {
    requestId: string
    path: string
}
export interface RemoteMediaThumbnailResult {
    requestId: string
    path: string
    thumbnail: string
}
export interface RemoteMediaPlayResult {
    requestId: string
    ok: boolean
    code?: RemoteMediaErrorCode
}
export interface RemoteMediaCancelRequest {
    requestId: string
}

/** replies to `API:<action>` requests whose payload the Remote reads */
export interface RemoteApiResponses {
    "API:get_thumbnail": { path: string; thumbnail?: string }
    "API:get_plain_text": { id: string; value: string }
    "API:get_groups": { id: string; value: unknown }
    "API:get_cleared": { all: boolean; background: boolean; slide: boolean; overlays: boolean; audio: boolean; slideTimers: boolean }
    "API:get_playing_audio_data": unknown
    "API:get_playing_audio_time": number
    "API:get_playing_video_time": number | null
    "API:get_playing_video_duration": number | null
    "API:get_playing_video_state": { duration?: number; time?: number; paused?: boolean; loop?: boolean; muted?: boolean } | null
    "API:get_media_loop_state": boolean
    "API:toggle_media_loop": unknown
    "API:get_pdf_thumbnails": { path: string; pages: string[] }
    "API:create_show": { show: Show; id: string }
}
/** `API:<action>` requests carry an untyped action payload; the action registry is outside this protocol */
export type RemoteApiChannel = `API:${string}`

// ---- main app -> Remote ---------------------------------------------------------------------------------

export interface RemoteResponses extends RemoteApiResponses {
    // access
    PASSWORD: RemotePasswordInfo
    ERROR: string
    ACCESS: null
    LANGUAGE: { lang: string; strings: Dictionary }
    // data
    SHOWS: TrimmedShows
    SHOW: RemoteShow
    OUT: RemoteOutSlide | RemoteOutTemp
    OUT_DATA: OutData
    PROJECTS: RemoteProject[]
    /** id of the project the main app has open */
    PROJECT: string | null
    FOLDERS: { folders: { [key: string]: unknown }; opened: string[] }
    SCRIPTURE: { [key: string]: BibleCategories }
    CATEGORIES: { [key: string]: unknown }
    GET_SCRIPTURE: RemoteScriptureResponse
    SEARCH_SCRIPTURE: RemoteScriptureSearchResponse
    GET_OVERLAYS: { overlays: Overlays; categories: Categories }
    GET_TEMPLATES: { templates: Templates; categories: Categories }
    GET_FUNCTIONS: RemoteFunctions
    // pushed by the main app when its data changes
    ACTIVE_SCRIPTURE: RemoteActiveScripture | null
    OVERLAYS: Overlays
    OVERLAY_CATEGORIES: Categories
    TEMPLATES: Templates
    TEMPLATE_CATEGORIES: Categories
    ACTIONS: { [key: string]: Action }
    ACTION_TAGS: { [key: string]: Tag }
    VARIABLES: { [key: string]: Variable }
    VARIABLE_TAGS: { [key: string]: Tag }
    TIMER_TAGS: { [key: string]: Tag }
    TIMERS: { [key: string]: Timer }
    ACTIVE_TIMERS: unknown[]
    RUNNING_ACTIONS: string[]
    GET_AUDIO: { [key: string]: unknown }
    MEDIA: { [key: string]: RemoteMediaSource } | null
    // media
    MEDIA_PAGE: RemoteMediaPage
    MEDIA_THUMBNAIL_RESULT: RemoteMediaThumbnailResult
    MEDIA_PLAY_RESULT: RemoteMediaPlayResult
    MEDIA_ERROR: RemoteMediaError
}
export type RemoteResponseKey = keyof RemoteResponses

// ---- Remote -> main app ---------------------------------------------------------------------------------

type Reply<K extends RemoteResponseKey> = Pick<RemoteResponses, K>

export interface RemoteProtocol {
    PASSWORD: { request: null; replies: Reply<"PASSWORD" | "SHOWS"> }
    ACCESS: { request: string; replies: Reply<"ERROR" | "SHOWS"> }
    SHOW: { request: string; replies: Reply<"SHOW"> }
    /** read-only twin of SHOW: answers the show without the main app opening it (used when replaying after a reconnect) */
    GET_SHOW: { request: string; replies: Reply<"SHOW"> }
    OUT: { request: RemoteOutRequest; replies: Reply<"OUT"> }
    OUT_DATA: { request: null; replies: Reply<"OUT_DATA"> }
    PROJECTS: { request: null; replies: Reply<"PROJECTS"> }
    GET_SCRIPTURE: { request: RemoteScriptureRequest; replies: Reply<"GET_SCRIPTURE"> }
    SEARCH_SCRIPTURE: { request: RemoteScriptureSearchRequest; replies: Reply<"SEARCH_SCRIPTURE"> }
    GET_OVERLAYS: { request: null; replies: Reply<"GET_OVERLAYS"> }
    GET_TEMPLATES: { request: null; replies: Reply<"GET_TEMPLATES"> }
    GET_FUNCTIONS: { request: null; replies: Reply<"GET_FUNCTIONS"> }
    MEDIA_LIST: { request: RemoteMediaPageRequest; replies: Reply<"MEDIA_PAGE" | "MEDIA_ERROR"> }
    MEDIA_CANCEL: { request: RemoteMediaCancelRequest; replies: Record<never, never> }
    MEDIA_THUMBNAIL: { request: RemoteMediaThumbnailRequestMessage; replies: Reply<"MEDIA_THUMBNAIL_RESULT" | "MEDIA_ERROR"> }
    MEDIA_PLAY: { request: RemoteMediaPlayRequest; replies: Reply<"MEDIA_PLAY_RESULT"> }
}
export type RemoteRequestKey = keyof RemoteProtocol & string

/** Compile-time exhaustive: adding a key to RemoteProtocol without listing it here fails to type-check. */
const REMOTE_REQUEST_KEY_MAP: { [K in RemoteRequestKey]: true } = {
    PASSWORD: true,
    ACCESS: true,
    SHOW: true,
    GET_SHOW: true,
    OUT: true,
    OUT_DATA: true,
    PROJECTS: true,
    GET_SCRIPTURE: true,
    SEARCH_SCRIPTURE: true,
    GET_OVERLAYS: true,
    GET_TEMPLATES: true,
    GET_FUNCTIONS: true,
    MEDIA_LIST: true,
    MEDIA_CANCEL: true,
    MEDIA_THUMBNAIL: true,
    MEDIA_PLAY: true
}
export const REMOTE_REQUEST_KEYS = Object.keys(REMOTE_REQUEST_KEY_MAP) as RemoteRequestKey[]
export function isRemoteRequestKey(channel: string): channel is RemoteRequestKey {
    return Object.prototype.hasOwnProperty.call(REMOTE_REQUEST_KEY_MAP, channel)
}

/** requests that need an authorized connection even when no password is set */
export const REMOTE_MEDIA_REQUEST_KEYS: readonly string[] = ["MEDIA_LIST", "MEDIA_CANCEL", "MEDIA_THUMBNAIL", "MEDIA_PLAY"]
/** requests and responses allowed before the connection is authorized */
export const REMOTE_PRE_AUTH_KEYS: readonly string[] = ["PASSWORD", "ACCESS", "ERROR", "LANGUAGE"]

/**
 * What the Remote re-issues after a reconnect, once access is granted again, for a request it made earlier.
 * Replay must never change operator state, so only side-effect-free reads are replayed: SHOW becomes the read-only
 * GET_SHOW (SHOW opens the show in the main window), OUT only as the `null` state query (any other OUT shows,
 * changes or clears a slide). Everything else is not replayed. Returns null when the request is not replayed.
 */
export function toRemoteReplayRequest(channel: string, data: unknown): { channel: RemoteRequestKey; data: unknown } | null {
    switch (channel) {
        case "SHOW":
            return { channel: "GET_SHOW", data }
        case "OUT":
            return data === null || data === undefined ? { channel: "OUT", data: null } : null
        case "OUT_DATA":
        case "GET_FUNCTIONS":
        case "GET_OVERLAYS":
        case "GET_TEMPLATES":
            return { channel, data: null }
        default:
            return null
    }
}

/** Compile-time check that RemoteProtocol satisfies the generic protocol constraint. */
export type RemoteProtocolCheck = WebProtocolDef<RemoteProtocol>
