import type { OutputStateObservation, OutputStateReady, OutputStateRejection, OutputStateRendered, OutputTopicSnapshot } from "../../types/OutputState"
import type { Message } from "../../types/Socket"

interface RoutableOutputStateBroker {
    publish: (snapshot: OutputTopicSnapshot) => unknown
    ready: (ready: OutputStateReady, authenticatedOutputId: string) => unknown
    applied: (observation: OutputStateObservation, authenticatedOutputId: string) => unknown
    rendered: (observation: OutputStateRendered, authenticatedOutputId: string) => unknown
    rejected: (rejection: OutputStateRejection, authenticatedOutputId: string) => unknown
}

interface OutputStateRoutingOptions {
    broker: RoutableOutputStateBroker
    getMainWebContentsId: () => number | null
    resolveOutputId: (webContentsId: number) => string | null
    reject: (rejection: { reason: "sender_main_mismatch" | "sender_output_mismatch" | "unregistered_sender"; channel: string; claimedOutputId?: string; authenticatedOutputId?: string }) => void
}

export class OutputStateRouting {
    private readonly options: OutputStateRoutingOptions

    constructor(options: OutputStateRoutingOptions) {
        this.options = options
    }

    receive(senderWebContentsId: number, message: Message): boolean {
        if (message.channel === "OUTPUT_STATE_PUBLISH") {
            if (senderWebContentsId !== this.options.getMainWebContentsId()) {
                this.options.reject({ reason: "sender_main_mismatch", channel: message.channel })
                return false
            }

            this.options.broker.publish(message.data)
            return true
        }

        if (!rendererChannels.has(message.channel)) return false

        const authenticatedOutputId = this.options.resolveOutputId(senderWebContentsId)
        if (!authenticatedOutputId) {
            this.options.reject({ reason: "unregistered_sender", channel: message.channel, claimedOutputId: message.data?.outputId })
            return false
        }
        if (message.data?.outputId !== authenticatedOutputId) {
            this.options.reject({ reason: "sender_output_mismatch", channel: message.channel, claimedOutputId: message.data?.outputId, authenticatedOutputId })
            return false
        }

        switch (message.channel) {
            case "OUTPUT_STATE_READY":
                this.options.broker.ready(message.data, authenticatedOutputId)
                break
            case "OUTPUT_STATE_APPLIED":
                this.options.broker.applied(message.data, authenticatedOutputId)
                break
            case "OUTPUT_STATE_RENDERED":
                this.options.broker.rendered(message.data, authenticatedOutputId)
                break
            case "OUTPUT_STATE_REJECTED":
                this.options.broker.rejected(message.data, authenticatedOutputId)
                break
        }
        return true
    }
}

const rendererChannels = new Set(["OUTPUT_STATE_READY", "OUTPUT_STATE_APPLIED", "OUTPUT_STATE_RENDERED", "OUTPUT_STATE_REJECTED"])
