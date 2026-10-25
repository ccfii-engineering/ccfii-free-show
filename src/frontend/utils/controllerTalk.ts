import { get } from "svelte/store"
import { uid } from "uid"
import { CONTROLLER } from "../../types/Channels"
import { Main } from "../../types/IPC/Main"
import type { ControllerPresenterPreview, ControllerPresenterSnapshot } from "../../types/remote/control"
import type { OutSlide, Show, Slide } from "../../types/Show"
import { defaultLayers, getFirstActiveOutput, getFirstOutput, getOutputResolution } from "../components/helpers/output"
import { OutputHelper } from "../components/helpers/OutputHelper"
import { clone } from "../components/helpers/array"
import { _show } from "../components/helpers/shows"
import { requestMainResult } from "../IPC/main"
import { resolvePresenterStyleLines } from "./controllerPresenter"
import { clearAll, clearSlide } from "../components/output/clear"
import { activeFocus, activeProject, activeShow, connections, focusMode, outputSlideCache, outputs, paintCache, projects, serverData, showsCache, special, styles } from "../stores"
import { draw, drawSettings, drawTool } from "./../stores"

let justCleared: NodeJS.Timeout | null = null
let presenterRevision = 0
let presenterSignature = ""
let latestPresenterSnapshot: ControllerPresenterSnapshot | null = null
let presenterAssetPaths = new Map<string, string>()
let lastPublishedPresenterRevision = 0
let presenterUpdateTimeout: NodeJS.Timeout | null = null

export const receiveCONTROLLER = {
    ACTION: ({ data }) => {
        const actions = {
            next: () => OutputHelper.advanceOutputs("next"),
            previous: () => OutputHelper.advanceOutputs("previous"),
            clear: () => {
                if (justCleared) {
                    clearTimeout(justCleared)
                    justCleared = null
                    clearAll()
                    return
                }

                clearSlide()
                justCleared = setTimeout(() => (justCleared = null), 2000)
            },
            clear_painting: () => clearPainting()
        }

        if (actions[data.id]) actions[data.id]()

        if (data.id !== "clear" && justCleared) {
            clearTimeout(justCleared)
            justCleared = null
        }
    },
    FOCUS: ({ data }) => {
        if (!data.offset) {
            draw.set(null)
            if (data.tool !== undefined) drawTool.set(data.tool || "focus")
            return
        }

        const outputId = getFirstActiveOutput()?.id || ""
        const resolution = getOutputResolution(outputId, get(outputs), true)
        data.offset.x *= resolution.width
        data.offset.y *= resolution.height

        const tool = data.tool || "focus"
        const settings = get(drawSettings)[tool]
        if (settings) {
            data.offset.x -= settings.size / 2
            data.offset.y -= settings.size / 2
        }

        draw.set(data.offset)
        drawTool.set(tool)

        if (tool === "paint") paintCache.set([{ x: 0, y: 0, size: 0, color: "#ffffff" }])
    },
    GET_OUTPUT_ID: ({ id }) => {
        return { id, channel: "GET_OUTPUT_ID", data: get(serverData)?.output_stream?.outputId || getFirstOutput()?.id }
    },
    PRESENTER_SUBSCRIBE: ({ id }) => {
        if (!id) return
        connections.update((all) => {
            if (!all.CONTROLLER?.[id]) return all
            all.CONTROLLER[id].presenter = true
            return all
        })
        const snapshot = getPresenterSnapshot()
        return { id, channel: "PRESENTER_STATE", data: snapshot }
    },
    PRESENTER_UNSUBSCRIBE: ({ id }) => {
        if (!id) return
        connections.update((all) => {
            if (all.CONTROLLER?.[id]) delete all.CONTROLLER[id].presenter
            return all
        })
    },
    PRESENTER_THUMBNAIL: async ({ id, data }) => {
        if (!id || !data || !isControllerConnected(id)) return
        const snapshot = getPresenterSnapshot()
        const path = snapshot.revision === data.revision ? presenterAssetPaths.get(data.assetId) : undefined
        if (!path) return { id, channel: "PRESENTER_THUMBNAIL_RESULT", data: { revision: data.revision, assetId: data.assetId, thumbnail: "" } }

        const result = await requestMainResult(Main.CONTROLLER_PRESENTER_THUMBNAIL, { connectionId: id, path, revision: data.revision, assetId: data.assetId })
        if (!isControllerConnected(id)) return

        const current = getPresenterSnapshot()
        if (current.revision !== data.revision || presenterAssetPaths.get(data.assetId) !== path) return

        return {
            id,
            channel: "PRESENTER_THUMBNAIL_RESULT",
            data: {
                revision: data.revision,
                assetId: data.assetId,
                thumbnail: result.status === "success" ? result.data.thumbnail : ""
            }
        }
    }
}

outputs.subscribe(schedulePresenterUpdate)
showsCache.subscribe(schedulePresenterUpdate)
projects.subscribe(schedulePresenterUpdate)
activeProject.subscribe(schedulePresenterUpdate)
activeShow.subscribe(schedulePresenterUpdate)
activeFocus.subscribe(schedulePresenterUpdate)
focusMode.subscribe(schedulePresenterUpdate)
outputSlideCache.subscribe(schedulePresenterUpdate)
special.subscribe(schedulePresenterUpdate)
styles.subscribe(schedulePresenterUpdate)

function schedulePresenterUpdate() {
    if (presenterUpdateTimeout) return
    presenterUpdateTimeout = setTimeout(() => {
        presenterUpdateTimeout = null
        publishPresenterSnapshot()
    }, 0)
}

function publishPresenterSnapshot() {
    const snapshot = getPresenterSnapshot()
    if (snapshot.revision === lastPublishedPresenterRevision) return
    lastPublishedPresenterRevision = snapshot.revision

    Object.entries(get(connections).CONTROLLER || {}).forEach(([id, connection]) => {
        if (connection.presenter) window.api.send(CONTROLLER, { id, channel: "PRESENTER_STATE", data: snapshot })
    })
}

function getPresenterSnapshot(): ControllerPresenterSnapshot {
    const output = getFirstActiveOutput()
    const outputId = output?.id || ""
    const out = output?.out || {}
    const outSlide = out.slide || null
    const style = output?.style ? get(styles)[output.style] : undefined
    const styleLines = resolvePresenterStyleLines(style, defaultLayers)
    const current = outSlide ? createPresenterPreview(outSlide, styleLines) : null
    const nextOut = outputId ? OutputHelper.getPresenterNext(outputId) : null
    const next = nextOut ? createPresenterPreview(nextOut, styleLines) : null
    const status: ControllerPresenterSnapshot["status"] = !output ? "empty" : outSlide?.id === "temp" || outSlide?.id === "tempText" ? "temp" : outSlide ? "slide" : out.presentationMode === "cleared" || !!get(outputSlideCache)[outputId] ? "cleared" : "empty"
    const currentShow = outSlide && outSlide.id !== "temp" && outSlide.id !== "tempText" ? get(showsCache)[outSlide.id] : null
    const currentLayoutId = outSlide?.layout || currentShow?.settings?.activeLayout
    const currentSlideNotes = status === "slide" && outSlide ? getPresenterSlideNotes(outSlide) : ""

    const snapshot: ControllerPresenterSnapshot = {
        revision: 0,
        outputId,
        status,
        ...(currentShow ? { showId: outSlide?.id, showName: currentShow.name, layoutId: currentLayoutId } : {}),
        current,
        next,
        notes: currentSlideNotes,
        atEnd: !next
    }
    const signature = JSON.stringify(snapshot)
    if (latestPresenterSnapshot && signature === presenterSignature) return latestPresenterSnapshot

    presenterSignature = signature
    presenterRevision++
    snapshot.revision = presenterRevision
    presenterAssetPaths = new Map()
    for (const preview of [snapshot.current, snapshot.next]) {
        if (!preview) continue
        Object.keys(preview.assets).forEach((assetPath) => {
            const assetId = uid(16)
            preview.assets[assetPath] = assetId
            presenterAssetPaths.set(assetId, assetPath)
        })
    }
    latestPresenterSnapshot = snapshot
    return snapshot
}

function createPresenterPreview(outSlide: OutSlide, styleLines: number): ControllerPresenterPreview | null {
    if (outSlide.id === "temp" || outSlide.id === "tempText") {
        const slide: Slide = { group: null, color: null, settings: outSlide.settings || {}, notes: "", items: clone(outSlide.tempItems || []) }
        const assets = getPreviewAssetPaths(slide, {})
        return { index: 0, slide, layoutSlide: { id: "", data: {} }, media: {}, assets, playback: getPresenterPlayback(outSlide, styleLines) }
    }

    const show = get(showsCache)[outSlide.id] as Show | undefined
    if (!show) return null
    const layoutId = outSlide.layout || show.settings?.activeLayout
    const layout =
        _show(outSlide.id)
            .layouts(layoutId ? [layoutId] : "active")
            .ref()?.[0] || []
    const index = outSlide.index ?? -1
    const layoutSlide = layout[index]
    if (!layoutSlide) return null

    const slide = clone(_show(outSlide.id).slides([layoutSlide.id]).get()?.[0] || show.slides[layoutSlide.id])
    if (!slide) return null
    const currentSlide: Slide = { ...slide, notes: "" }
    const backgroundMediaId = (layoutSlide as any).background || ""
    const referencedMedia = new Set<string>()
    if (backgroundMediaId && show.media?.[backgroundMediaId]) referencedMedia.add(backgroundMediaId)
    ;(slide.items || []).forEach((item) => {
        if (item.type === "media" && item.src && show.media?.[item.src]) referencedMedia.add(item.src)
    })

    const media: Show["media"] = {}
    referencedMedia.forEach((mediaId) => {
        const path = show.media[mediaId]?.path
        if (path) media[mediaId] = { path }
    })
    const assets = getPreviewAssetPaths(currentSlide, media)
    return {
        showId: outSlide.id,
        showName: show.name,
        layoutId,
        index,
        slide: currentSlide,
        layoutSlide,
        media,
        assets,
        playback: getPresenterPlayback(outSlide, styleLines)
    }
}

function getPreviewAssetPaths(slide: Slide, media: Show["media"]): Record<string, string> {
    const paths = new Set<string>()
    const addPath = (value: string | undefined) => {
        if (!value || value.length > 4096 || /^(data|blob|https?):/i.test(value)) return
        if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value)) return
        const extension = value.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase() || ""
        if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "avif", "heic", "mp4", "webm", "mov", "m4v", "avi", "mkv", "mpeg", "mpg"].includes(extension)) paths.add(value)
    }

    Object.values(media || {}).forEach((entry) => addPath(entry.path))
    ;(slide.items || []).forEach((item) => {
        if (item.type === "media") addPath(item.src)
    })
    if (slide.settings?.backgroundImage) addPath(slide.settings.backgroundImage)

    return Object.fromEntries([...paths].map((assetPath) => [assetPath, ""]))
}

function getPresenterPlayback(outSlide: OutSlide, styleLines: number): ControllerPresenterPreview["playback"] {
    const { line, revealCount, itemClickReveal } = outSlide
    return { line, revealCount, itemClickReveal, styleLines }
}

function getPresenterSlideNotes(outSlide: OutSlide) {
    const show = get(showsCache)[outSlide.id]
    if (!show) return ""
    const layoutId = outSlide.layout || show.settings?.activeLayout
    const layout =
        _show(outSlide.id)
            .layouts(layoutId ? [layoutId] : "active")
            .ref()?.[0] || []
    const layoutSlide = layout[outSlide.index ?? -1]
    if (!layoutSlide) return ""
    return _show(outSlide.id).slides([layoutSlide.id]).get()?.[0]?.notes || show.slides[layoutSlide.id]?.notes || ""
}

function isControllerConnected(connectionId: string) {
    return !!get(connections).CONTROLLER?.[connectionId]
}

function clearPainting() {
    paintCache.set([])

    drawSettings.update((a) => {
        if (!a.paint) a.paint = { color: "#ffffff", size: 10, threed: false, dots: false, hold: true }
        a.paint.clear = true
        return a
    })
    setTimeout(() => {
        drawSettings.update((a) => {
            delete a.paint.clear
            return a
        })
    }, 50)
}

// export async function sendBackgroundToController(outputId: string, updater = get(outputs)) {
//     let currentOutput = updater[outputId]?.out
//     let path = currentOutput?.background?.path || ""

//     if (!path) {
//         send(CONTROLLER, ["BACKGROUND"], { path: "" })
//         return
//     }

//     let base64path = await getBase64Path(path)

//     let bg = clone({ path: base64path, mediaStyle: get(media)[path] || {} })

//     send(CONTROLLER, ["BACKGROUND"], bg)
//     return
// }
