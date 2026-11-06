// Generic helpers for typed web control protocols (Remote today; Stage and Controller reuse these).
//
// A protocol is one interface that maps each REQUEST key to its payload and the REPLY channels a handler
// may answer with. Reply payloads live in a separate flat response map, so the client receiver table and
// the main-app handler table are both derived from the same declarations.

export interface WebMessageDef {
    /** payload the client sends under this key; `null` when the message carries no data */
    request: unknown
    /** reply channels a handler may answer with, and their payloads */
    replies: object
}

/** Constraint for a protocol interface: every key must be a WebMessageDef. Use as `P extends WebProtocolDef<P>`. */
export type WebProtocolDef<P> = { [K in keyof P]: WebMessageDef }

type Awaitable<T> = T | Promise<T>

/** A request as the main app receives it, typed per key. */
export interface WebRequestMessage<P extends WebProtocolDef<P>, K extends keyof P & string> {
    id?: string
    channel: K
    data: P[K]["request"]
}

/** The union of messages a handler may reply with. */
export type WebReplyMessage<P extends WebProtocolDef<P>, K extends keyof P & string> = {
    [C in keyof P[K]["replies"] & string]: { id?: string; channel: C; data: P[K]["replies"][C] }
}[keyof P[K]["replies"] & string]

export type WebHandler<P extends WebProtocolDef<P>, K extends keyof P & string> = (msg: WebRequestMessage<P, K>) => Awaitable<WebReplyMessage<P, K> | void | undefined>

/** Main-app handler table: one handler per request key, no more and no less. */
export type WebHandlerTable<P extends WebProtocolDef<P>> = { [K in keyof P & string]: WebHandler<P, K> }

/** Client receiver table: handlers for the response channels a client chooses to act on. */
export type WebReceiverTable<Responses extends object> = { [C in keyof Responses & string]?: (data: Responses[C]) => void }

/** Arguments for a client `send(key, ...args)`: the payload is omitted when the request carries none. */
export type WebSendArgs<P extends WebProtocolDef<P>, K extends keyof P & string> = P[K]["request"] extends null ? [data?: null] : [data: P[K]["request"]]
