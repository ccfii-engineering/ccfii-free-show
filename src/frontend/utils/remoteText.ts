import { get } from "svelte/store"
import type { RemoteTextSaveRequest, RemoteTextSaveResult } from "../../types/remote/protocol"
import { loadShows } from "../components/helpers/setShow"
import { formatText } from "../components/show/formatTextEditor"
import { showsCache } from "../showsCacheState/showsCache.svelte"
import { activeShow } from "../stores"
import { getAccess } from "./profile"

/**
 * Saves lyrics text typed on the Remote (and for automations that call `set_plain_text`).
 * The target is the show named in the request; without an id the desktop's active show is used.
 * Same guards as the desktop Text tab: a locked show or a show with locked slides, and read-only profiles.
 * A refused save changes nothing and answers with the reason, so the Remote can keep the draft and tell the operator.
 */
export async function saveRemoteText(request: RemoteTextSaveRequest): Promise<RemoteTextSaveResult> {
    const activeId = get(activeShow)
    const showId = request?.id || (activeId && (activeId.type || "show") === "show" ? activeId.id : "")
    if (!showId || typeof request?.value !== "string") return { status: "blocked", reason: "no_show", ...(showId ? { showId } : {}) }

    await loadShows([showId])
    const show = get(showsCache)[showId]
    if (!show) return { status: "blocked", reason: "no_show", showId }

    if (show.locked) return { status: "blocked", reason: "show_locked", showId }
    const access = getAccess("shows")
    if (access.global === "read" || access[show.category || ""] === "read") return { status: "blocked", reason: "read_only", showId }
    if (Object.values(show.slides || {}).some((slide) => slide?.locked)) return { status: "blocked", reason: "slide_locked", showId }

    formatText(request.value, showId, "none")
    return { status: "saved", showId }
}
