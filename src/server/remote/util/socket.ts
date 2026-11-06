import type { RemoteApiChannel, RemoteProtocol, RemoteRequestKey, RemoteResponseKey, RemoteResponses } from "../../../types/remote/protocol"
import { isRemoteReplayRequest, REMOTE_PRE_AUTH_KEYS } from "../../../types/remote/protocol"
import type { WebSendArgs } from "../../../types/WebProtocol"
import { createWebClient } from "../../common/util/webClient"
import { receiver } from "./receiver"
import { _set, _update } from "./stores"

// The Remote uses the shared web client. It adds the saved-password handshake and the `API:<action>` requests.
// Offline rule: live sends are dropped while disconnected (only PASSWORD/ACCESS pass); data requests
// (show, output, functions, ...) are re-issued after reconnect once access is granted (markReady).
const client = createWebClient<RemoteProtocol, RemoteResponses>({
    event: "REMOTE",
    preAuthKeys: REMOTE_PRE_AUTH_KEYS,
    gateInbound: true,
    replay: isRemoteReplayRequest,
    onConnect: () => {
        // try accessing with saved password
        const SAVED_PASSWORD = localStorage.password
        if (SAVED_PASSWORD) {
            _update("password", "remember", true)
            _update("password", "stored", SAVED_PASSWORD)
            send("ACCESS", SAVED_PASSWORD)
            return
        }

        // check if there is a password!
        send("PASSWORD")
    },
    onDisconnect: () => _set("isConnected", false)
})

export function initSocket() {
    client.start(receiver)
}

/** The connection is authorized: re-issue the data requests the view asked for before the reconnect. */
export function markReady() {
    client.setReady(true)
}

/** Listen for one response channel; the payload type comes from the protocol. */
export function onResponse<C extends RemoteResponseKey>(channel: C, listener: (data: RemoteResponses[C]) => void) {
    return client.onResponse(channel, listener)
}

/** Send a protocol request, or an `API:<action>` request (its action payload is outside the protocol). */
export function send<K extends RemoteRequestKey>(channel: K, ...data: WebSendArgs<RemoteProtocol, K>): void
export function send(channel: RemoteApiChannel, data?: unknown): void
export function send(channel: string, data: unknown = null) {
    client.sendRaw(channel, data)
}
