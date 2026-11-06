import { get } from "svelte/store"
import { STAGE } from "../../types/Channels"
import type { OutSlide } from "../../types/Show"
import type { StageLayoutData, StageProgress, StageProtocol } from "../../types/stage/protocol"
import type { WebHandlerTable } from "../../types/WebProtocol"
import { runAction } from "../components/actions/actions"
import { clone, keysToID } from "../components/helpers/array"
import { getBase64Path } from "../components/helpers/media"
import { checkWindowCapture, getFirstOutput } from "../components/helpers/output"
import { getCurrentProjectIndexes, getProjectItems } from "../components/helpers/projectProgress"
import { getGroupName, getLayoutRef } from "../components/helpers/show"
import { _show } from "../components/helpers/shows"
import { getCustomStageLabel } from "../components/stage/stage"
import { actions, activeProject, activeShow, events, groups, media, outputs, projects, showsCache, stageShows, timeFormat, timers, variables } from "../stores"
import { connections } from "./../stores"
import { translateText } from "./language"
import { send } from "./request"
import { arrayToObject, filterObjectArray, sendData, setConnectedState } from "./sendData"

// WIP loading different paths, might cause returned base64 to be different than it should if previous thumbnail finishes after
export async function sendBackgroundToStage(outputId, updater = get(outputs), returnPath = false) {
    const currentOutput = updater[outputId]?.out
    const next = await getNextBackground(currentOutput?.slide || null, returnPath)
    const next2 = await getNextBackground(currentOutput?.slide || null, returnPath, 2)
    let path = currentOutput?.background?.path || ""
    if (typeof path !== "string") path = ""

    if (returnPath) {
        return clone({ path, mediaStyle: get(media)[path] || {}, next, next2 })
    }

    if (!path && !next.path?.length) {
        if (!returnPath) send(STAGE, ["BACKGROUND"], { path: "" })
        return
    }

    const stageConnections = Object.keys(get(connections).STAGE || {})?.length || 0
    const base64path = stageConnections > 0 ? await getBase64Path(path) : ""

    const bg = clone({ path: base64path, filePath: path, mediaStyle: get(media)[path] || {}, next, next2 })

    if (returnPath) return bg

    send(STAGE, ["BACKGROUND"], bg)
    return
}

async function getNextBackground(currentOutputSlide: OutSlide | null, returnPath = false, slideOffset = 1) {
    if (!currentOutputSlide?.id) return {}

    const showRef = _show(currentOutputSlide.id).layouts([currentOutputSlide.layout]).ref()[0]
    if (!showRef) return {}

    // GET CORRECT INDEX OFFSET, EXCLUDING DISABLED SLIDES
    let layoutOffset = currentOutputSlide.index || 0
    let offsetFromCurrentExcludingDisabled = 0
    while (offsetFromCurrentExcludingDisabled < slideOffset && layoutOffset <= showRef.length) {
        layoutOffset++
        if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled++
    }
    const slideIndex = layoutOffset

    const nextLayout = showRef[slideIndex]
    if (!nextLayout) return {}

    const bgId = nextLayout.data.background || ""
    let path = _show(currentOutputSlide.id).media([bgId]).get()?.[0]?.path || ""
    if (typeof path !== "string") path = ""

    if (returnPath) return { path, mediaStyle: get(media)[path] || {} }

    const base64path = await getBase64Path(path)

    return { path: base64path, filePath: path, mediaStyle: get(media)[path] || {} }
}

export const receiveSTAGE: WebHandlerTable<StageProtocol> = {
    LAYOUTS: (msg) => ({
        id: msg.id,
        channel: "LAYOUTS",
        data: keysToID(get(stageShows))
            .filter((a) => !a.disabled)
            .map((a) => ({ id: a.id, name: a.name, password: !!a.password }))
    }),
    LAYOUT: (msg) => {
        const data = msg.data
        const connectionId = msg.id || ""
        let layout: any = get(stageShows)[data.id]
        if (!layout || layout.disabled) return { id: msg.id, channel: "ERROR", data: "noShow" }
        if (layout.password && layout.password !== data.password) return { id: msg.id, channel: "ERROR", data: "wrongPass" }
        setConnectedState("STAGE", connectionId, "active", data.id)

        layout = arrayToObject(filterObjectArray(get(stageShows), ["disabled", "name", "settings", "items"]))[data.id]

        // add labels
        Object.keys(layout.items).map((itemId) => {
            const item = layout.items[itemId]
            item.label = getCustomStageLabel(item.type || itemId, item)
        })

        // if (show.disabled) return { id: connectionId, channel: "ERROR", data: "noShow" }

        // initial
        sendData(STAGE, { channel: "OUT" })
        sendData(STAGE, { channel: "SHOW_DATA" })
        window.api.send(STAGE, { id: connectionId, channel: "TIMERS", data: get(timers) })
        window.api.send(STAGE, { id: connectionId, channel: "EVENTS", data: get(events) })
        window.api.send(STAGE, { id: connectionId, channel: "VARIABLES", data: get(variables) })
        send(STAGE, ["DATA"], { timeFormat: get(timeFormat) })

        // send media items
        Object.values(layout.items).forEach(async (item: any) => {
            if (item.type === "media" && item.src) {
                const data = await getBase64Path(item.src)
                send(STAGE, ["MEDIA"], { path: item.src, value: data })
            }
        })

        return { id: msg.id, channel: "LAYOUT", data: layout as StageLayoutData }
    },

    OUT: (msg) => {
        const connectionId = msg.id || ""
        let stageId = msg.data?.id
        if (!stageId) stageId = get(connections).STAGE?.[connectionId]?.active
        if (!stageId) return

        const stageLayout = get(stageShows)[stageId]
        if (!stageLayout) return

        const sourceOutputId = stageLayout.settings?.output
        const outputStores = get(outputs)
        const outputId = sourceOutputId && outputStores[sourceOutputId] ? sourceOutputId : getFirstOutput()?.id
        const output = { ...get(outputs)[outputId], id: outputId }
        if (!output?.out) return

        const outSlideId = output.out.slide?.id
        if (outSlideId) send(STAGE, ["SHOW_DATA"], { id: outSlideId, show: get(showsCache)[outSlideId] })

        sendBackgroundToStage(outputId)
        return { id: msg.id, channel: "OUT", data: output }
    },
    SHOW_DATA: (msg) => {
        const connectionId = msg.id || ""
        const stageId = get(connections).STAGE?.[connectionId]?.active
        if (!stageId) return

        const stageLayout = get(stageShows)[stageId]
        if (!stageLayout) return

        const sourceOutputId = stageLayout.settings?.output
        const outputStores = get(outputs)
        const outputId = sourceOutputId && outputStores[sourceOutputId] ? sourceOutputId : getFirstOutput()?.id
        const outSlideId = get(outputs)[outputId]?.out?.slide?.id || ""
        const show = get(showsCache)[outSlideId]
        if (!show) return

        // send media items
        Object.values(show.media || {}).forEach(async (media) => {
            const data = await getBase64Path(media.path || "")
            send(STAGE, ["MEDIA"], { path: media.path, value: data })
        })

        return { id: msg.id, channel: "SHOW_DATA", data: { id: outSlideId, show } }
    },

    REQUEST_PROGRESS: (msg) => {
        const data: StageProgress = msg.data
        let outputId = data.outputId
        if (!outputId) outputId = getFirstOutput()?.id
        if (!outputId) return

        const currentSlideOut = get(outputs)[outputId]?.out?.slide || null
        const currentShowId = currentSlideOut?.id || ""
        const currentShowSlide = currentSlideOut?.index ?? -1
        const currentLayoutRef = getLayoutRef(currentShowId)
        const currentShowSlides = _show(currentShowId).get("slides") || {}
        const slidesLength = currentLayoutRef.length || 0

        // get custom group names
        const layoutGroups = currentLayoutRef.map((a) => {
            const ref = a.parent || a
            const slide = currentShowSlides[ref.id]
            if (!slide) return { name: "—" }

            if (a.data.disabled || slide.group?.startsWith("~")) return { hide: true }

            let group = slide.group || "—"
            if (slide.globalGroup && get(groups)[slide.globalGroup]) {
                group = get(groups)[slide.globalGroup].default ? translateText("groups." + get(groups)[slide.globalGroup].name) : get(groups)[slide.globalGroup].name
            }

            if (typeof group !== "string") group = ""
            const name = getGroupName({ show: _show(currentShowId).get(), showId: currentShowId }, ref.id, group, ref.layoutIndex)?.replace(/ *\([^)]*\) */g, "")
            const oneLetterName = getGroupName({ show: _show(currentShowId).get(), showId: currentShowId }, ref.id, group[0].toUpperCase(), ref.layoutIndex)?.replace(/ *\([^)]*\) */g, "")
            return { name: name || "—", oneLetterName: (oneLetterName || "—").replace(" ", ""), index: ref.layoutIndex, child: a.type === "child" ? (currentLayoutRef[ref.layoutIndex]?.children || []).findIndex((id) => id === a.id) + 1 : 0 }
        })

        // Project progress

        const currentProjectItems = get(projects)[get(activeProject) || ""]?.shows || []
        const activeProjectItem = get(activeShow)
        const activeProjectItemIndex = typeof activeProjectItem?.index === "number" ? activeProjectItem.index : -1

        const currentOut = get(outputs)[outputId]?.out || {}
        const currentProjectIndexes = getCurrentProjectIndexes(currentProjectItems, currentOut, activeProjectItemIndex)
        const projectItems = getProjectItems(currentProjectItems, get(showsCache))

        data.progress = { currentShowSlide, slidesLength, layoutGroups, projectItems, currentProjectIndexes }

        return { id: msg.id, channel: "REQUEST_PROGRESS", data }
    },

    // sent by clients with a visible "current output" mirror item (renewed while visible)
    STREAM_SUBSCRIBE: (msg) => {
        if (addStageStreamViewer(msg.id || "", msg.data?.outputId)) checkWindowCapture()
    },
    STREAM_UNSUBSCRIBE: (msg) => {
        removeStageStreamViewer(msg.id || "")
        checkWindowCapture()
    },

    RUN_ACTION: (msg) => {
        const a = msg.data
        const connectionId = msg.id || ""
        const stageId = get(connections).STAGE?.[connectionId]?.active
        const hasPassword = Object.values(get(stageShows) || {}).some((s: any) => s?.password)
        if (hasPassword && !stageId) return

        runAction(get(actions)[a.id], { source: "remote" })
    }

    // case "SHOW":
    //   data = getStageShow(message.data)
    //   break
    // case "BACKGROUND":
    //   data = getOutBackground()
    //   break
    // case "SLIDE":
    //   data = getOutSlide()
    //   break
    // case "OVERLAYS":
    //   data = getOutOverlays()
    //   break
}

// tracks StageShow connections actively viewing an "Output window" item
const viewers: { [socketId: string]: { expires: number; outputId?: string } } = {}
const VIEWER_TTL = 10000 // subscriptions are renewed by a client heartbeat
export function addStageStreamViewer(socketId: string, outputId?: string): boolean {
    if (!socketId) return false

    const isNew = !viewers[socketId]
    viewers[socketId] = { expires: Date.now() + VIEWER_TTL, outputId: outputId || viewers[socketId]?.outputId }
    return isNew
}
export function removeStageStreamViewer(socketId: string) {
    delete viewers[socketId]
}

export function hasStageStreamViewers(connectedIds: string[], outputId: string): boolean {
    const connected = new Set(connectedIds)
    const now = Date.now()
    Object.keys(viewers).forEach((socketId) => {
        if (!connected.has(socketId) || viewers[socketId].expires < now) delete viewers[socketId]
    })

    // a viewer without a specific output (no stage layout output set) matches any output
    return Object.values(viewers).some((viewer) => !viewer.outputId || viewer.outputId === outputId)
}
