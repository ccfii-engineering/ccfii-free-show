import type { DrawTools } from "../Draw"
import type { WebProtocolDef } from "../WebProtocol"
import type { ControllerPresenterSnapshot, ControllerPresenterThumbnailRequest, ControllerPresenterThumbnailResult } from "../remote/control"

// Web Control Protocol for Controller (same pattern as ../remote/protocol.ts).
// The presenter contracts (revisioned snapshot, thumbnails) live in ../remote/control.ts; this file maps them to channels.

export type ControllerActionId = "next" | "previous" | "clear" | "clear_painting"
export interface ControllerActionRequest {
    id: ControllerActionId | (string & {})
}
export interface ControllerFocusRequest {
    /** position relative to the output (0..1), or `null` when the pointer is released */
    offset: { x: number; y: number } | null
    tool?: DrawTools | null
}
export interface ControllerOutputFrameRequest {
    outputId: string
}
export interface ControllerOutputFrame {
    frame: string
    width: number
    height: number
}

export interface ControllerResponses {
    GET_OUTPUT_ID: string | undefined
    PRESENTER_STATE: ControllerPresenterSnapshot
    PRESENTER_THUMBNAIL_RESULT: ControllerPresenterThumbnailResult
    /** answered by the Electron server layer, not the app handler table */
    OUTPUT_FRAME: ControllerOutputFrame
}
export type ControllerResponseKey = keyof ControllerResponses

type Reply<K extends ControllerResponseKey> = Pick<ControllerResponses, K>
type NoReply = Record<never, never>

/** requests the main app answers (handler table keys) */
export interface ControllerProtocol {
    ACTION: { request: ControllerActionRequest; replies: NoReply }
    FOCUS: { request: ControllerFocusRequest; replies: NoReply }
    GET_OUTPUT_ID: { request: null; replies: Reply<"GET_OUTPUT_ID"> }
    PRESENTER_SUBSCRIBE: { request: null; replies: Reply<"PRESENTER_STATE"> }
    PRESENTER_UNSUBSCRIBE: { request: null; replies: NoReply }
    PRESENTER_THUMBNAIL: { request: ControllerPresenterThumbnailRequest; replies: Reply<"PRESENTER_THUMBNAIL_RESULT"> }
}
export type ControllerRequestKey = keyof ControllerProtocol & string

/** what the Controller client may send: the app protocol plus the frame request the Electron server answers */
export interface ControllerClientProtocol extends ControllerProtocol {
    OUTPUT_FRAME: { request: ControllerOutputFrameRequest; replies: Reply<"OUTPUT_FRAME"> }
}

/** Compile-time exhaustive: adding a key to ControllerProtocol without listing it here fails to type-check. */
const CONTROLLER_REQUEST_KEY_MAP: { [K in ControllerRequestKey]: true } = {
    ACTION: true,
    FOCUS: true,
    GET_OUTPUT_ID: true,
    PRESENTER_SUBSCRIBE: true,
    PRESENTER_UNSUBSCRIBE: true,
    PRESENTER_THUMBNAIL: true
}
export const CONTROLLER_REQUEST_KEYS = Object.keys(CONTROLLER_REQUEST_KEY_MAP) as ControllerRequestKey[]
export function isControllerRequestKey(channel: string): channel is ControllerRequestKey {
    return Object.prototype.hasOwnProperty.call(CONTROLLER_REQUEST_KEY_MAP, channel)
}

/** Compile-time check that the protocols satisfy the generic protocol constraint. */
export type ControllerProtocolCheck = WebProtocolDef<ControllerClientProtocol>
