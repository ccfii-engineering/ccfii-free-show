import type { WebProtocolDef } from "../WebProtocol"

// Web Control Protocols for the two stream-only web apps. They have no handler table in the main app:
// the Electron server layer (src/electron/servers.ts, capture) answers them.

/** Output stream page: frames and audio in, acknowledgements out */
export interface OutputStreamResponses {
    STREAM: { id: string; [key: string]: unknown }
    AUDIO_BUFFER: { buffer: ArrayBuffer; sampleRate: number; channelCount: number }
}
export interface OutputStreamProtocol {
    STREAM_DONE: { request: { id: string; success: boolean }; replies: Record<never, never> }
}

/** Camera page: sends frames, receives nothing */
export type CamResponses = Record<never, never>
export interface CamProtocol {
    STREAM: { request: string; replies: Record<never, never> }
}

/** Compile-time checks that the protocols satisfy the generic protocol constraint. */
export type OutputStreamProtocolCheck = WebProtocolDef<OutputStreamProtocol>
export type CamProtocolCheck = WebProtocolDef<CamProtocol>
