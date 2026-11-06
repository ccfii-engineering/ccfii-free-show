import type { Dictionary } from "../../../types/Settings"
import type { RemoteTextBlockReason } from "../../../types/remote/protocol"
import { translate } from "./helpers"
import { onResponse, send } from "./socket"
import { _get, _update } from "./stores"

/** how long the Remote waits for the main app to answer a lyrics save */
export const LYRICS_SAVE_TIMEOUT = 8000

export type LyricsSaveOutcome = { status: "saved" } | { status: "blocked"; reason: RemoteTextBlockReason } | { status: "offline" } | { status: "no_reply" }

/**
 * Sends the lyrics text for one show and resolves with what the main app answered.
 * Nothing is sent while the connection is down (the shared client would drop it), and the caller keeps the draft
 * unless the outcome is "saved", so an edit is never lost silently.
 */
export function saveLyrics(showId: string, value: string): Promise<LyricsSaveOutcome> {
    if (!showId) return Promise.resolve({ status: "blocked", reason: "no_show" })
    if (!_get("isConnected")) return Promise.resolve({ status: "offline" })

    return new Promise((resolve) => {
        const finish = (outcome: LyricsSaveOutcome) => {
            clearTimeout(timer)
            stop()
            resolve(outcome)
        }
        const stop = onResponse("API:set_plain_text", (data) => {
            if (data?.showId && data.showId !== showId) return
            if (data?.status === "saved") {
                // the cached text is now what was saved
                _update("textCache", showId, value)
                return finish({ status: "saved" })
            }
            finish({ status: "blocked", reason: data?.status === "blocked" ? data.reason : "no_show" })
        })
        const timer = setTimeout(() => finish({ status: "no_reply" }), LYRICS_SAVE_TIMEOUT)

        send("API:set_plain_text", { id: showId, value })
    })
}

/** the sentence the operator reads for a save outcome */
export function lyricsSaveMessage(outcome: LyricsSaveOutcome, d: Dictionary): string {
    if (outcome.status === "saved") return translate("edit.lyrics_saved", d)
    if (outcome.status === "offline") return translate("edit.lyrics_offline", d)
    if (outcome.status === "no_reply") return translate("edit.lyrics_no_reply", d)
    return translate("edit.lyrics_blocked_" + outcome.reason, d)
}
