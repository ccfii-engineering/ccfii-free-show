import { get } from "svelte/store"
import { getTemplateApplyBlock, type ApplyScope } from "../../common/templates/templateInUse"
import type { RemoteTemplateRequest, RemoteTemplateResult } from "../../types/remote/protocol"
import { history } from "../components/helpers/history"
import { loadShows } from "../components/helpers/setShow"
import { getLayoutRef, isSlideLocked } from "../components/helpers/show"
import { activeShow, categories, templates } from "../stores"
import { showsCache } from "../showsCacheState/showsCache.svelte"
import { getAccess } from "./profile"

/**
 * Applies a template for the Remote (and for automations that call `set_template`).
 * The target is the show named in the request, not the desktop's active show; without a show id the active show is used.
 * Same guards as the Templates drawer: locked show, read-only profile, category template (whole show only).
 */
export async function applyRemoteTemplate(request: RemoteTemplateRequest): Promise<RemoteTemplateResult> {
    const templateId = request?.id || ""
    const activeId = get(activeShow)
    const showId = request?.showId || (activeId && (activeId.type || "show") === "show" ? activeId.id : "")
    if (!showId) return { status: "blocked", reason: "no_show" }
    if (!templateId || !get(templates)[templateId]) return { status: "blocked", reason: "unknown_template", showId }

    await loadShows([showId])
    const show = get(showsCache)[showId]
    if (!show) return { status: "blocked", reason: "no_show", showId }

    const scope: ApplyScope = request.scope === "slides" ? "slides" : "show"
    const categoryId = show.category || ""
    const access = getAccess("shows")
    const reason = getTemplateApplyBlock({
        scope,
        showLocked: !!show.locked,
        readOnly: access.global === "read" || access[categoryId] === "read",
        categoryTemplateId: get(categories)[categoryId]?.template || ""
    })
    if (reason) return { status: "blocked", reason, showId }

    if (scope === "slides") {
        const ref = getLayoutRef(showId)
        const slideIds = [...new Set((request.slides || []).map((index) => ref[index]?.id).filter((id): id is string => !!id && !isSlideLocked(showId, id)))]
        if (!slideIds.length) return { status: "blocked", reason: "no_slides", showId }

        // one history step: undo and redo restore the slides, not only the template id
        history({ id: "slideTemplate", newData: { template: templateId, slideIds }, location: { page: "edit", show: { id: showId } } })
        return { status: "applied", showId, scope, count: slideIds.length }
    }

    history({ id: "TEMPLATE", newData: { id: templateId, data: { createItems: true } }, location: { page: "none", override: "show#" + showId } })
    return { status: "applied", showId, scope, count: getLayoutRef(showId).length }
}
