import type { StageProtocol, StageResponses } from "../../../types/stage/protocol"
import { toStageReplayRequest } from "../../../types/stage/protocol"
import type { WebSendArgs } from "../../../types/WebProtocol"
import { createWebClient } from "../../common/util/webClient"
import { receiver } from "./receiver"

// The Stage uses the shared web client. On every (re)connect it asks for the layouts, which reopens the
// layout it showed; once the app confirms the layout (markReady) the output/show/progress requests are re-issued.
const client = createWebClient<StageProtocol, StageResponses>({
    event: "STAGE",
    replay: toStageReplayRequest,
    onConnect: () => client.send("LAYOUTS")
})

export function initSocket() {
    client.start(receiver)
}

/** The layout is open on the app side: re-issue the data requests the view made before a reconnect. */
export function markReady() {
    client.setReady(true)
}

export function send<K extends keyof StageProtocol & string>(channel: K, ...data: WebSendArgs<StageProtocol, K>) {
    client.send(channel, ...data)
}

/** Ask the app and wait for the matching reply; null when offline, on timeout or on disconnect. */
export function awaitRequest(channel: string, data: unknown = null) {
    return client.request(channel, data)
}
