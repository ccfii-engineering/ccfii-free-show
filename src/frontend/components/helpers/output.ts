import { get } from "svelte/store"
import { uid } from "uid"
import { OUTPUT } from "../../../types/Channels"
import { Main } from "../../../types/IPC/Main"
import type { Output, Outputs, RtmpDestination } from "../../../types/Output"
import type { Resolution, Styles } from "../../../types/Settings"
import type { Item, OutSlide, Show, Slide, SlideData, Template, TemplateSettings, Transition } from "../../../types/Show"
import { getOutputLineWindow, getRevealLineWindow } from "../../../common/outputLineWindows"
import { AudioAnalyser } from "../../audio/audioAnalyser"
import { fadeinAllPlayingAudio, fadeoutAllPlayingAudio } from "../../audio/audioFading"
import { requestMain, sendMain } from "../../IPC/main"
import { updateOutputs } from "../../outputState/outputs.svelte"
import { actions, activeProject, activeRename, activeTimers, allOutputs, categories, connections, currentOutputSettings, customMessageCredits, disabledServers, effects, lockedOverlays, media, outputDisplay, outputs, outputSlideCache, outputState, overlays, overlayTimers, playingVideos, projects, scriptures, scriptureSettings, serverData, showsCache, special, stageShows, styles, templates, theme, themes, transitionData, usageLog } from "../../stores"
import { trackScriptureUsage } from "../../utils/analytics"
import { isMainWindow, isOutputWindow, newToast } from "../../utils/common"
import { translateText } from "../../utils/language"
import { confirmCustom } from "../../utils/popup"
import { updateMappedEntries } from "../../utils/mapStoreEntries"
import { send } from "../../utils/request"
import { sendBackgroundToStage } from "../../utils/stageTalk"
import { TemplateHelper } from "../../utils/templates"
import { videoExtensions } from "../../values/extensions"
import { customActionActivation, runAction } from "../actions/actions"
import type { API_camera, API_screen, API_stage_output_layout } from "../actions/api"
import { getSlideText } from "../edit/scripts/textStyle"
import type { EditInput } from "../edit/values/boxes"
import { clearBackground, clearSlide } from "../output/clear"
import { clone, keysToID, removeDuplicates, sortByName, sortObject } from "./array"
import { getExtension, getMediaLayerType } from "./media"
import { createDestination, hasStreamableDestination } from "./rtmpDestinations"
import { getLayoutRef } from "./show"
import { getFewestOutputLines, getItemWithMostLines, replaceDynamicValues } from "./showActions"
import { _show } from "./shows"
import { getStyles } from "./style"
import { mergeWithTemplate } from "./slideTemplateMerge"
import { getFirstOutputIdWithAudableBackground } from "./video"
import { nextPresentationMode } from "../output/presentationState"
import { makeOutputVideoData, makeOutputVideoTime, matchesOutputBackground } from "../media/video/outputPlaybackControl"
import { outputSeekTracker } from "../media/video/outputSeekTracker"

export function toggleOutputs(outputIds: string[] | null = null, options: { force?: boolean; autoStartup?: boolean; state?: boolean } = {}) {
    if (outputIds === null) outputIds = getActiveOutputs(get(outputs), false)
    // if (outputIds === null) outputIds = Object.keys(get(outputs))

    const outputsList = outputIds.map((id) => ({ ...get(outputs)[id], id })).filter((a) => a.enabled)
    if (!outputsList.length) return

    // sort so display order can be changed! (needs app restart)
    const sortedOutputList = sortObject(sortByName(outputsList), "stageOutput")

    const currentOutputState = !!get(outputState).find((a) => a.id === outputIds[0])?.active
    const state = typeof options.state === "boolean" ? options.state : options.force || !(outputIds.length === 1 ? currentOutputState : get(outputDisplay))

    const autoPosition = sortedOutputList.length === 1 && !sortedOutputList[0].forcedResolution?.width

    send(OUTPUT, ["TOGGLE_OUTPUTS"], { outputs: sortedOutputList, state, force: options.force, autoStartup: options.autoStartup, autoPosition })
}

export function toggleOutput(id: string) {
    toggleOutputs([id])
}

// background: null,
// slide: null,
// overlays: [],
// transition: null,
// TODO: updating a output when a "next slide timer" is active, will "reset/remove" the "next slide timer"
let resetActionTrigger = false
export function setOutput(type: string, data: any, toggle = false, outputId = "", add = false) {
    const ref = data?.layout ? _show(data.id).layouts([data.layout]).ref()[0] || [] : []

    customActionActivation("output_changed")

    // track usage (& set attributionString)
    if (type === "slide" && data?.id) {
        const showReference = _show(data.id).get("reference")
        const slide = _show(data.id).get("slides")?.[ref[data.index]?.id] || {}
        if (showReference?.type === "scripture") {
            const translation = showReference.data

            const scripture = get(scriptures)[translation.collection] || {}
            const versions = scripture.collection?.versions || [scripture.id || ""]
            versions.forEach((id) => {
                const name = get(scriptures)[id]?.name || translation.version || ""
                const scriptureId = get(scriptures)[id]?.id || id
                const apiId = translation.api ? scriptureId : null
                if (name || apiId) trackScriptureUsage(name, apiId, slide.group)
            })

            // set attributionString
            if (translation.attributionString) data.attributionString = translation.attributionString
        }

        const groupId = slide.globalGroup
        if (groupId) customActionActivation("group_start", groupId)
    }

    updateOutputs((a) => {
        const bindings = data?.bindings || (data?.layout ? ref[data.index]?.data?.bindings || [] : [])
        const allOutputIds = bindings.length ? bindings : getActiveOutputs(a, true, false, true)
        const outs = outputId ? [outputId] : allOutputIds
        const inputData = clone(data)
        const updatedEntries: Record<string, Output> = {}

        const backgroundId = getFirstOutputIdWithAudableBackground(allOutputIds)

        if (type === "slide" && data?.id) {
            // reset slide cache (after update)
            setTimeout(() => outputSlideCache.set({}), 50)

            const currentOutSlideId = get(outputs)[outs?.[0]]?.out?.slide?.id || ""

            // log usage if show is not currently outputted
            if (currentOutSlideId !== data?.id) appendShowUsage(data.id)

            const overrideCategoryAction = ref[data?.index]?.data?.actions?.slideActions?.find((action) => Object.values(action.customData || {}).find((a1) => Object.entries(a1).find(([key, value]) => key === "overrideCategoryAction" && value === true)))

            // run category action if show slide is not currently outputted, and it does not have a custom override action
            if (currentOutSlideId !== data?.id || resetActionTrigger) {
                const category = get(showsCache)[data.id]?.category || ""
                const categoryActionId = get(categories)[category]?.action
                if (!overrideCategoryAction && categoryActionId) runAction(get(actions)[categoryActionId], {}, true)
            }

            if (overrideCategoryAction) resetActionTrigger = true
            else resetActionTrigger = false

            // if current playing background is "foreground", clear it
            const currentBackground = get(outputs)[outs?.[0]]?.out?.background || {}
            const mediaData = get(media)[currentBackground.path || ""] || {}
            const mediaType = getMediaLayerType(currentBackground.path || "", mediaData)
            if (mediaType === "foreground") clearBackground()
        }

        let toggleState = false
        outs.forEach((id: string, i: number) => {
            const output = a[id]
            if (!output) return
            let nextOutput = output

            if (!nextOutput.out) nextOutput = { ...nextOutput, out: {} }
            if (!nextOutput.out?.[type]) nextOutput = { ...nextOutput, out: { ...nextOutput.out, [type]: type === "overlays" || type === "effects" ? [] : null } }
            data = clone(inputData)

            if (type === "slide" && data === null && output.out?.slide?.type === "ppt") {
                sendMain(Main.PRESENTATION_CONTROL, { action: "stop" })
            }

            if (type === "background") {
                // clear if PDF/PPT is active
                const slideContent = getOutputContent(id)
                if (data && (slideContent.type === "pdf" || slideContent.type === "ppt")) clearSlide()

                data = changeOutputBackground(data, { output, id, mute: allOutputIds.length > 1 && id !== backgroundId, videoOutputId: backgroundId })
            }

            let outData = nextOutput.out?.[type] || null
            if ((type === "overlays" || type === "effects") && data?.length) {
                if (!Array.isArray(data)) data = [data]
                if (toggle && i === 0) toggleState = outData?.includes(data[0])
                if (toggle && toggleState) outData.splice(outData.indexOf(data[0]), 1)
                else if (toggle || add) outData = removeDuplicates([...(nextOutput.out?.[type] || []), ...data])
                else outData = data

                data.forEach((overlayId) => {
                    // timeout so output can update first
                    if (outData.includes(overlayId)) startOverlayTimer(id, overlayId, outData, type)
                    else if (get(overlayTimers)[id + overlayId]) clearOverlayTimer(id, overlayId)
                })
            } else {
                if (data) delete data.bindings // currently used for bg muting
                outData = data

                if (type === "overlays" || type === "effects") {
                    clearOverlayTimers(id)
                }
            }

            nextOutput = { ...nextOutput, out: { ...nextOutput.out, presentationMode: nextPresentationMode(nextOutput.out?.presentationMode, type, outData), [type]: clone(outData) } }

            // save locked overlays
            if (type === "overlays") lockedOverlays.set(outData)

            updatedEntries[id] = nextOutput
        })

        return updateMappedEntries(a, Object.keys(updatedEntries), (_entry, id) => updatedEntries[id] || _entry)
    })
}

export function startFolderTimer(folderPath: string, file: { type: string; path: string }) {
    // WIP timer loop does not work if project is changed (should be global for the folder instead of per project item)
    const projectItems = get(projects)[get(activeProject) || ""]?.shows || []
    // this does not work with multiple of the same folder
    const projectItemIndex = projectItems.findIndex((a) => (a.type === "folder" || a.type === "pdf") && a.id === folderPath)
    const timer = Number(projectItems?.[projectItemIndex]?.data?.timer ?? 10)
    if (!timer || (file.type !== "image" && file.type !== "pdf")) return

    // newSlideTimer played from Preview.svelte
    setOutput("transition", { duration: timer, folderPath })
}

// WIP smarter logging (based on time or based on percentage played)
let justLogged = ""
function appendShowUsage(showId: string) {
    if (!get(special).logSongUsage) return

    const show = get(showsCache)[showId]
    if (!show) return

    // only log once in a row
    if (show.name === justLogged) return
    justLogged = show.name || ""

    usageLog.update((a) => {
        const metadata = show.meta || {}
        // remove empty values
        Object.keys(metadata).forEach((key) => {
            if (!metadata[key]) delete metadata[key]
        })

        if (!a.all) a.all = []
        a.all.push({
            name: show.name,
            time: Date.now(),
            metadata
        })

        return a
    })
}

function changeOutputBackground(data, { output, id, mute, videoOutputId }) {
    if (isMainWindow()) {
        setTimeout(() => {
            // update stage background if any
            sendBackgroundToStage(id)
            // send thumbnail to controller
            // sendBackgroundToController(id)
        }, 100)
    }

    const previousWasVideo: boolean = videoExtensions.includes(getExtension(output.out?.background?.path))

    if (data === null) {
        if (id === videoOutputId) fadeinAllPlayingAudio()
        if (previousWasVideo) videoEnding()

        return data
    }

    // mute videos in the other output windows if more than one
    // WIP fix multiple outputs: if an output with style without background is first the video will be muted... even if another output should not be muted
    data.muted = data.muted || false
    if (mute) data.muted = true

    const identity = data.path || data.id || ""

    if (id === videoOutputId) {
        const muteAudio = get(special).muteAudioWhenVideoPlays
        const isVideo = data.type === "player" || data.type === "video" || videoExtensions.includes(getExtension(data.path))
        if (!data.muted && muteAudio && isVideo) fadeoutAllPlayingAudio()
        else fadeinAllPlayingAudio()

        if (isVideo) videoStarting()
        else if (previousWasVideo) videoEnding()
    }

    // wait for video receiver to change
    const startRequestedAt = outputSeekTracker.now()
    setTimeout(() => {
        const currentBackground = get(outputs)[id]?.out?.background
        if (!matchesOutputBackground(identity, currentBackground)) return

        const currentVideoData = makeOutputVideoData(identity, { muted: currentBackground?.muted ?? false, loop: currentBackground?.loop || false })
        send(OUTPUT, ["DATA"], { [id]: currentVideoData })
        // an operator seek made while waiting is newer than startAt
        if (currentBackground?.startAt !== undefined && !outputSeekTracker.seekedSince(id, startRequestedAt)) send(OUTPUT, ["TIME"], { [id]: makeOutputVideoTime(identity, currentBackground.startAt || 0) })
    }, 600)

    return data
}

function videoEnding() {
    setTimeout(() => {
        customActionActivation("video_end")
    })
}
function videoStarting() {
    customActionActivation("video_start")
}

export function startCamera(cam: API_camera) {
    setOutput("background", { name: cam.name || "", id: cam.id, cameraGroup: cam.groupId, type: "camera" })
}

export function startScreen(screen: API_screen) {
    setOutput("background", { name: screen.name || "", id: screen.id, type: "screen" })
}

/// OVERLAY TIMERS

function startOverlayTimer(outputId: string, overlayId: string, outData: string[] = [], type: "overlays" | "effects" = "overlays") {
    if (!outData.length) outData = get(outputs)[outputId]?.out?.[type] || []
    if (!outData.includes(overlayId)) return

    const overlay = type === "overlays" ? get(overlays)[overlayId] : get(effects)[overlayId]
    if (!overlay?.displayDuration) return

    overlayTimers.update((a) => {
        const id = outputId + overlayId
        if (a[id]) clearTimeout(a[id].timer)

        a[id] = {
            outputId,
            overlayId,
            timer: setTimeout(() => {
                clearOverlayTimer(outputId, overlayId)
                if (!get(outputs)[outputId]?.out?.[type]?.includes(overlayId)) return

                setOutput(type, overlayId, true, outputId)
            }, overlay.displayDuration! * 1000)
        }

        return a
    })
}

export function clearOverlayTimers(outputId: string) {
    Object.values(get(overlayTimers)).forEach((a) => clearOverlayTimer(outputId, a.overlayId))
}

export function clearOverlayTimer(outputId: string, overlayId: string) {
    overlayTimers.update((a) => {
        const id = outputId + overlayId
        if (!a[id]) return a

        clearTimeout(a[id].timer)
        delete a[id]
        return a
    })
}

///

export function getAllOutputs(outputsData: Outputs = get(outputs)) {
    if (!Object.keys(outputsData).length) return [{ ...clone(defaultOutput), id: "default" }]
    // sort by normal first A-Z, then stage A-Z
    return sortObject(sortByName(keysToID(outputsData)), "stageOutput")
    // return sortByName(keysToID(get(outputs)))
}
export function getAllEnabledOutputs(outputsData: Outputs = get(outputs)) {
    const outputsList = getAllOutputs(outputsData)
    const enabled = outputsList.filter((a) => a.enabled)
    if (!enabled.length && isMainWindow()) {
        updateOutputs((a) => updateMappedEntries(a, [Object.keys(a)[0]], (entry) => ({ ...entry, enabled: true })))
        return [outputsList[0]]
    }
    return enabled
}

export function getAllNormalOutputs(outputsData: Outputs = get(outputs)) {
    return getAllEnabledOutputs(outputsData).filter((a) => !a.stageOutput)
}
export function getAllStageOutputs() {
    return getAllEnabledOutputs().filter((a) => a.stageOutput)
}

export function getFirstOutput() {
    return getAllNormalOutputs()[0]
}

// get window output id
export function getWindowOutputId() {
    if (!isOutputWindow()) return getFirstOutput()?.id || ""
    return getActiveOutputs(get(outputs), false, true, true)[0]
    // return getActiveOutputs(get(allOutputs), false, true, true)[0]
}

export function getAllActiveOutputs(outputsData: Outputs = get(outputs)) {
    const outputsList = getAllNormalOutputs(outputsData)
    const active = outputsList.filter((a) => a.active)
    if (!active.length && isMainWindow()) {
        updateOutputs((a) => updateMappedEntries(a, [Object.keys(a)[0]], (entry) => ({ ...entry, active: true })))
        return [outputsList[0]]
    }
    return active
}
export function getAllActiveOutputIds() {
    return getAllActiveOutputs().map(({ id }) => id)
}
export function getFirstActiveOutput(outputsData: Outputs = get(outputs)) {
    const firstActive = getAllActiveOutputs(outputsData)[0]
    if (firstActive) return firstActive

    // create one if none exist
    if (!getAllOutputs(outputsData).filter((a) => !a.stageOutput).length && isMainWindow()) addOutput(true)

    // get first regardless of active state (re-read: addOutput may have created one)
    return keysToID(get(outputs)).find((a) => !a.stageOutput)
}

// DEPRECATED
let sortedOutputs: (Output & { id: string })[] = []
export function getActiveOutputs(outputsData: Outputs = get(outputs), hasToBeActive = true, removeKeyOutput = false, shouldRemoveStageOutput = false) {
    // keyOutput is not in use anymore
    // WIP cache outputs
    // if (JSON.stringify(sortedOutputs.map(({ id }) => id)) !== JSON.stringify(Object.keys(outputsData))) {
    //     sortedOutputs = sortByName(keysToID(outputsData || {}))
    // }
    sortedOutputs = sortByName(keysToID(outputsData || {}))

    let enabled = sortedOutputs.filter((a) => a.enabled === true && (removeKeyOutput ? !(a as any).isKeyOutput : true) && (shouldRemoveStageOutput ? !a.stageOutput : true))

    if (hasToBeActive && enabled.filter((a) => a.active === true).length) enabled = enabled.filter((a) => a.active === true)

    let enabledIds = enabled.map((a) => a.id)

    if (!enabledIds.length) {
        if (!sortedOutputs.length && isMainWindow()) addOutput(true)
        if (sortedOutputs[0]) enabledIds = [sortedOutputs[0].id]
    }

    return enabledIds
}

export function findMatchingOut(id: string, outputsData: Outputs = get(outputs)): string | null {
    let match: string | null = null

    // TODO: more than one active

    getActiveOutputs(outputsData, false, true, true).forEach((outputId: string) => {
        const output = outputsData[outputId]
        if (match === null && output.enabled) {
            // TODO: index & layout: $outSlide?.index === i && $outSlide?.id === $activeShow?.id && $outSlide?.layout === activeLayout
            // slides (edit) + slides
            if (output.out?.slide?.id === id) match = output.color
            else if ((output.out?.background?.path || output.out?.background?.id) === id) match = output.color
            else if (output.out?.overlays?.includes(id)) match = output.color
            else if (output.out?.effects?.includes(id)) match = output.color
        }
    })

    // if (match && match === "#F0008C" && get(themes)[get(theme)]?.colors?.secondary) {
    //   match = get(themes)[get(theme)]?.colors?.secondary
    // }

    return match
}

// used for checking if style template should be used as slide preview - only if all outputs have it
export function allOutputsHasStyleTemplate(isScripture: boolean = false) {
    const outputs = getAllNormalOutputs()
    return outputs.every((output) => {
        const style = output.style ? get(styles)[output.style] || null : null
        const template = style?.[isScripture ? "templateScripture" : "template"]
        return !!template
    })
}

export function refreshOut(refresh = true) {
    updateOutputs((a) =>
        updateMappedEntries(
            a,
            getAllActiveOutputs().map(({ id }) => id),
            (entry) => ({ ...entry, out: { ...entry.out, refresh } })
        )
    )

    if (refresh) {
        setTimeout(() => {
            refreshOut(false)
        }, 100)
    }
}

// outputs is just for updates
export function isOutCleared(key: string | null = null, outputsData: Outputs = get(outputs), checkLocked = false) {
    let cleared = true
    const outputIds = getActiveOutputs(outputsData, true, true, true)

    outputIds.forEach((outputId: string) => {
        if (!cleared) return

        const output = outputsData[outputId]
        if (output.out?.presentationMode === "cleared") return
        const keys: string[] = key ? [key] : Object.keys(output.out || {}).filter((type) => type !== "presentationMode")
        cleared = !keys.find((type: string) => {
            if (!output.out?.[type]) return

            if (type === "overlays") {
                if (checkLocked && output.out.overlays?.length) return true
                if (!checkLocked && output.out.overlays?.filter((id: string) => !get(overlays)[id]?.locked).length) return true
                return false
            }
            if (type === "effects") {
                return output.out.effects?.length
            }

            return output.out[type] !== null
        })
    })

    if (cleared && key === "transition") {
        // check overlay timers
        cleared = !outputIds.find((outputId) => Object.values(get(overlayTimers)).find((a) => a.outputId === outputId))
        // check actual timers
        if (cleared) cleared = !Object.keys(get(activeTimers)).length
    }

    return cleared
}

export function getOutputContent(outputId = "", outputsData = get(outputs), key = "slide") {
    if (!outputId) outputId = getActiveOutputs(outputsData, false, true, true)[0]
    return outputsData[outputId]?.out?.[key] || {}
}

export function outputSlideHasContent(output) {
    if (!output) return false

    const outSlide: OutSlide = output.out?.slide
    if (!outSlide) return false

    const showRef = _show(outSlide.id).layouts([outSlide.layout]).ref()[0] || []
    if (!showRef.length) return false

    const currentSlide = _show(outSlide.id).slides([showRef[outSlide.index!]?.id]).get()?.[0]
    if (!currentSlide) return false

    return !!getSlideText(currentSlide)?.length
}

// WIP style should override any slide resolution & color ? (it does not)

// this actually gets aspect ratio
// `data` is real input, not a reactivity trigger: pass the store values a reactive statement depends on ({ outputs: $outputs, styles: $styles })
export function getResolution(initial: Resolution | undefined | null = null, data: { outputs?: Outputs; styles?: { [key: string]: Styles } } | null = null, outputId = "", styleIdOverride = ""): Resolution {
    if (initial) return initial

    const outputsData = data?.outputs ?? get(outputs)
    const stylesData = data?.styles ?? get(styles)

    if (!outputId) outputId = getFirstActiveOutput(outputsData)?.id || ""
    const currentOutput = outputsData[outputId]

    if (currentOutput?.stageOutput) return currentOutput.bounds

    const style = styleIdOverride || currentOutput?.style ? stylesData[(styleIdOverride || currentOutput?.style)!] || null : null
    const styleRatio: any = style?.aspectRatio || style?.resolution

    const ratio = styleRatio?.outputResolutionAsRatio ? currentOutput?.bounds : styleRatio

    return ratio || { width: 16, height: 9 }
}

// this will get the first available stage output
export function getStageOutputId(outputsData: Outputs = get(outputs)) {
    return keysToID(outputsData).find((a) => a.stageOutput && a.enabled)?.id || ""
}
export function getStageResolution(outputId = "", outputsData: Outputs = get(outputs)): Resolution {
    if (!outputId) outputId = getStageOutputId(outputsData)
    return getOutputResolution(outputId, outputsData)
}

// calculate actual output resolution based on style aspect ratio
export const DEFAULT_BOUNDS = { width: 1920, height: 1080 }
export function getOutputResolution(outputId: string, outputsData: Outputs = get(outputs), scaled = false, styleIdOverride = "") {
    const currentOutput = outputsData[outputId]
    const outputRes = clone(currentOutput?.bounds || DEFAULT_BOUNDS)

    const styleRatio = getResolution(null, { outputs: outputsData }, outputId, styleIdOverride)
    const styleAspectRatio = styleRatio.width / styleRatio.height

    const defaultRatio = DEFAULT_BOUNDS.width / DEFAULT_BOUNDS.height

    // set the width OR height based on the relative size
    const outputAspectRatio = outputRes.width / outputRes.height
    if (outputAspectRatio < 1 && styleAspectRatio > 1 && styleAspectRatio === defaultRatio) {
        outputRes.height = DEFAULT_BOUNDS.height
        outputRes.width = Math.round(DEFAULT_BOUNDS.height * outputAspectRatio)
    } else {
        outputRes.width = DEFAULT_BOUNDS.width
        outputRes.height = Math.round(DEFAULT_BOUNDS.width / outputAspectRatio)
    }

    if (!scaled) return outputRes

    // return styleRatio

    // output window size is narrow
    //  && outputAspectRatio > 1
    if (styleAspectRatio < 1) {
        outputRes.width = Math.round(outputRes.height * styleAspectRatio)
    } else {
        outputRes.height = Math.round(outputRes.width / styleAspectRatio)
    }

    // WIP: correct values....
    // const outputRes2 = clone(currentOutput?.bounds || DEFAULT_BOUNDS)
    // const newAspectRatio = outputRes.width / outputRes.height
    // if (outputRes2.width < outputRes2.height) {
    //     outputRes2.height = Math.round(newAspectRatio < 1 && styleAspectRatio > 1 ? outputRes2.width * newAspectRatio : outputRes2.width / newAspectRatio)
    //     // outputRes2.width = outputRes2.width
    // } else {
    //     outputRes2.width = Math.round(newAspectRatio < 1 && styleAspectRatio > 1 ? outputRes2.height / newAspectRatio : outputRes2.height * newAspectRatio)
    // }

    // if (newStyleAspectRatio < 1) {
    //     outputRes2.height = Math.round(outputRes.width / newStyleAspectRatio)
    // } else {
    //     outputRes2.width = Math.round(outputRes.height * newStyleAspectRatio)
    // }

    return outputRes
}

export function stylePosToPercentage(stylesData: { [key: string]: any }) {
    if (stylesData.left) stylesData.left = (Number(stylesData.left) / DEFAULT_BOUNDS.width) * 100
    if (stylesData.top) stylesData.top = (Number(stylesData.top) / DEFAULT_BOUNDS.height) * 100
    if (stylesData.width) stylesData.width = (Number(stylesData.width) / DEFAULT_BOUNDS.width) * 100
    if (stylesData.height) stylesData.height = (Number(stylesData.height) / DEFAULT_BOUNDS.height) * 100

    return stylesData
}

export function percentageStylePos(style: string, resolution: Resolution) {
    let stylesData = getStyles(style, true)
    stylesData = stylePosToPercentage(stylesData)

    const aspectRatio = resolution.width / resolution.height
    const width = DEFAULT_BOUNDS.width
    const height = DEFAULT_BOUNDS.width / aspectRatio

    style += ";"
    if (stylesData.left) style += "left: " + width * (Number(stylesData.left) / 100) + "px;"
    if (stylesData.top) style += "top: " + height * (Number(stylesData.top) / 100) + "px;"
    if (stylesData.width) style += "width: " + width * (Number(stylesData.width) / 100) + "px;"
    if (stylesData.height) style += "height: " + height * (Number(stylesData.height) / 100) + "px;"

    return style
}

export function percentageToAspectRatio(input: EditInput) {
    if (input.id !== "style") return input

    if (input.key === "left" || input.key === "width") input.value = DEFAULT_BOUNDS.width * (trimPixelValue(input.value) / 100) + "px"
    else if (input.key === "top" || input.key === "height") input.value = DEFAULT_BOUNDS.height * (trimPixelValue(input.value) / 100) + "px"

    return input
}

function trimPixelValue(value: any) {
    return Number(value?.toString().replace("px", ""))
}

export function checkWindowCapture(startup = false) {
    getAllEnabledOutputs().forEach(({ id }) => shouldBeCaptured(id, startup))

    AudioAnalyser.recorderActivate()
}

// NDI | OutputShow | Stage CurrentOutput
export function shouldBeCaptured(outputId: string, startup = false) {
    const output = get(outputs)[outputId]
    const captures = {
        ndi: !!output.ndi,
        server: !!(get(disabledServers).output_stream === false && (get(serverData)?.output_stream?.outputId || getFirstOutput()?.id) === outputId),
        stage: !get(disabledServers).stage && Object.keys(get(connections).STAGE || {}).length > 0 && stageHasOutput(outputId)
    }

    // alert user that screen recording starts
    if (!startup && Object.values(captures).filter(Boolean).length) newToast("toast.output_capture_enabled")

    send(OUTPUT, ["CAPTURE"], { id: outputId, captures })
}
function stageHasOutput(outputId: string) {
    return !!Object.keys(get(stageShows)).find((stageId) => {
        const stageLayout = get(stageShows)[stageId]
        let outputItem = stageLayout.items ? stageLayout.items["output#current_output"] : undefined

        if (!outputItem?.enabled) {
            outputItem = Object.values(stageLayout.items).find((a) => a.type === "current_output")
            if (!outputItem) return false
        }

        return (outputItem?.currentOutput?.source || stageLayout.settings?.output || outputId) === outputId

        // WIP check that this stage layout is not disabled & used in a output or (web enabled (disabledServers) + has connection)!
    })
}

// settings

export const defaultOutput: Output = {
    enabled: true,
    active: true,
    name: "Output",
    color: "#F0008C",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, // x: 1920 ?
    screen: null
}

// WIP history
export function addOutput(onlyFirst = false, styleId = "") {
    if (onlyFirst && get(outputs).length) return

    updateOutputs((output) => {
        const id = uid()
        if (get(themes)[get(theme)]?.colors?.secondary) defaultOutput.color = get(themes)[get(theme)].colors.secondary!
        output[id] = clone(defaultOutput)
        if (styleId) output[id].style = styleId

        // set name
        let n = 0
        while (Object.values(output).find((a) => a.name === output[id].name + (n ? " " + n : ""))) n++
        if (n) output[id].name = output[id].name + " " + n
        if (onlyFirst) output[id].name = translateText("theme.primary")

        // show
        // , rate: get(special).previewRate || "auto"
        if (!onlyFirst) send(OUTPUT, ["CREATE"], { id, ...output[id] })
        if (!onlyFirst && get(outputDisplay)) toggleOutput(id)

        if (get(currentOutputSettings) !== id) currentOutputSettings.set(id)
        activeRename.set("output_" + id)
        return output
    })
}

// WIP history
export function enableStageOutput(options: any = {}) {
    const bounds = getFirstActiveOutput()?.bounds || { x: 0, y: 0, width: 100, height: 100 }
    const id = uid()

    updateOutputs((a) => {
        a[id] = {
            enabled: true,
            active: true,
            stageOutput: "",
            name: "",
            color: "#555555",
            bounds,
            screen: null,
            ...options
        }

        send(OUTPUT, ["CREATE"], { ...a[id], id })
        activeRename.set("output_" + id)

        return a
    })

    return id
}

export function changeStageOutputLayout(data: API_stage_output_layout) {
    if (!data.stageLayoutId) return

    const outputIds = data.outputId ? [data.outputId] : Object.keys(get(outputs))

    updateOutputs((a) => {
        return updateMappedEntries(a, outputIds, (entry) => {
            if (!entry?.stageOutput) return entry
            return { ...entry, stageOutput: data.stageLayoutId }
        })
    })
}

export function deleteOutput(outputId: string) {
    if (Object.keys(get(outputs)).length <= 1) return

    updateOutputs((a) => {
        send(OUTPUT, ["REMOVE"], { id: outputId })
        delete a[outputId]

        currentOutputSettings.set(Object.keys(a)[0])
        return a
    })
}

export async function clearPlayingVideo(clearOutput = "") {
    const mediaTransition: Transition = getCurrentMediaTransition()

    let duration = (mediaTransition?.duration || 0) + 200
    if (!clearOutput) duration /= 2.4 // a little less than half the time

    return new Promise((resolve) => {
        setTimeout(() => {
            // remove from playing
            playingVideos.update((playingVideo) => {
                let existing = -1
                do {
                    existing = playingVideo.findIndex((a) => (clearOutput ? a.id === clearOutput : a.location === "output") || a.location === "preview")
                    if (existing > -1) playingVideo.splice(existing, 1)
                } while (existing > -1)

                return playingVideo
            })
            // playingVideos.set([])

            //   let video = null
            const videoData = {
                time: 0,
                duration: 0,
                paused: !!clearOutput,
                muted: false,
                loop: false
            }

            // if (!AudioAnalyser.shouldAnalyse()) {
            //     // wait for video to clear in output
            //     setTimeout(() => AudioAnalyserMerger.stop(), 5000)
            // }

            // send(OUTPUT, ["UPDATE_VIDEO"], { id: clearOutput, data: videoData, time: 0 })

            resolve(videoData)
        }, duration)
    })
}

export function getCurrentMediaTransition() {
    const transition: Transition = get(transitionData).media

    const currentOutput = getFirstActiveOutput()
    const out = currentOutput?.out || {}
    const slide = out.slide || null
    const slideData = get(showsCache) && slide && slide.id !== "temp" ? getLayoutRef(slide.id)[slide.index!]?.data : null
    const slideMediaTransition = slideData ? slideData.mediaTransition : null

    return slideMediaTransition || transition
}

function getSlideItemsFromTemplate(templateSettings: TemplateSettings) {
    const newItems: Item[] = []

    // these are set by the output style: resolution, backgroundColor, backgroundPath
    // this is not relevant: firstSlideTemplate

    // add overlay items
    if (templateSettings.overlayId) {
        const overlayItems = get(overlays)[templateSettings.overlayId]?.items || []
        newItems.push(...overlayItems)
    }

    return newItems
}

// OUTPUT COMPONENT

export const defaultLayers: string[] = ["background", "slide", "overlays"]

export function getCurrentStyle(stylesUpdater: { [key: string]: Styles }, styleId: string | undefined): Styles {
    const defaultStyle = { name: "" }

    if (!styleId) return defaultStyle
    return stylesUpdater[styleId] || defaultStyle
}

export function getOutputTransitions(slideData: SlideData | null, styleTransition: any, transitionDataUpdater: any, disableTransitions: boolean) {
    let transitions: { [key: string]: Transition } = {}

    if (disableTransitions) {
        const disabled: Transition = { type: "none", duration: 0, easing: "" }
        transitions = { text: disabled, media: disabled, overlay: disabled }
        return clone(transitions)
    }

    const slideTransitions = {
        text: slideData?.transition?.type ? slideData.transition : null,
        media: slideData?.mediaTransition?.type ? slideData.mediaTransition : null
    }

    const styleTransitions = {
        text: styleTransition?.text || null,
        media: styleTransition?.media || null
    }

    transitions.text = slideTransitions.text || styleTransitions.text || transitionDataUpdater.text || {}
    transitions.media = slideTransitions.media || styleTransitions.media || transitionDataUpdater.media || {}
    transitions.overlay = styleTransitions.text || transitionDataUpdater.text || {}

    return clone(transitions)
}

export function getStyleTemplate(outSlide: OutSlide | null, currentStyle: Styles | undefined, slideDynamicValues?: { [key: string]: any }) {
    if (!currentStyle) return {} as Template

    // scripture
    const reference = _show(outSlide?.id).get("reference")
    // also check per-slide customDynamicValues so slides in non-scripture shows are detected correctly
    const hasScriptureDynamicValues = !!slideDynamicValues && Object.keys(slideDynamicValues).some((k) => k.startsWith("scripture"))
    const isScripture = outSlide?.id === "temp" || reference?.type === "scripture" || hasScriptureDynamicValues

    const translations: number = outSlide?.id === "temp" ? outSlide.translations || 1 : reference?.data?.translations || reference?.data?.version?.split("+")?.length || 1
    const translationKey = translations > 1 ? `_${translations}` : ""

    const templateId = isScripture ? currentStyle[`templateScripture${translationKey}`] || currentStyle.templateScripture : currentStyle.template
    const template = get(templates)[templateId || ""] || {}

    return template
}

export function slideHasAutoSizeItem(slide: Slide | Template) {
    return slide?.items?.find((a) => a.auto)
}

export function setTemplateStyle(outSlide: OutSlide | null, currentStyle: Styles, items: Item[] | undefined, outputId: string, slideDynamicValues?: { [key: string]: any }) {
    if (!Array.isArray(items)) return []

    const isDrawerScripture = outSlide?.id === "temp"
    const slideItems = isDrawerScripture ? outSlide.tempItems : items

    const customDynamicValues = isDrawerScripture ? outSlide.customDynamicValues : slideDynamicValues

    const template = getStyleTemplate(outSlide, currentStyle, customDynamicValues)
    const templateItems = template.items || []
    const mode = template?.settings?.mode

    // console.log("[DEBUG - setTemplateStyle]", {
    //     outSlideId: outSlide?.id,
    //     templateId: currentStyle?.template,
    //     templateMode: mode,
    //     templateItemsCount: templateItems.length,
    //     slideItemsCount: slideItems?.length,
    //     templateAuto: templateItems?.find((i) => i.auto),
    //     outputId
    // })

    const newItems = mergeWithTemplate(slideItems || [], templateItems, true, true, false, mode, customDynamicValues, { scriptureNumberColor: get(scriptureSettings).numberColor }) || []
    newItems.push(...getSlideItemsFromTemplate(template.settings || {}))

    // console.log("[DEBUG - setTemplateStyle] After merge", {
    //     newItemsCount: newItems.length,
    //     newItemsAuto: newItems?.find((i) => i.auto)
    // })

    return newItems.filter(checkSpecificOutput)

    function checkSpecificOutput(item: Item) {
        if (!item) return false
        if (outSlide === null) return true // always show in slides preview
        return !item.bindings?.length || item.bindings.includes(outputId)
    }
}

// , currentSlide: Slide | null = null
export function getOutputLines(outSlide: OutSlide, styleLines = 0) {
    if (!outSlide?.id || outSlide.id === "temp") return { start: null, end: null } // , index: 0, max: 0

    const ref = _show(outSlide.id).layouts([outSlide.layout]).ref()[0]
    const showSlide: Slide | null =
        _show(outSlide.id)
            .slides([ref?.[outSlide.index ?? -1]?.id])
            .get()[0] || null
    const maxLines = showSlide ? getItemWithMostLines(showSlide) : 0

    const clickRevealItems = (showSlide?.items || []).filter((a) => a.clickReveal)
    const clickRevealed = clickRevealItems.length ? !!outSlide.itemClickReveal : true

    if (!maxLines) return { start: null, end: null, clickRevealed } // , index: 0, max: 0

    const maxStyleLines = Number(styleLines || 0)

    // ensure last content is shown when e.g. two styles has 2 & 3 lines, and the slide has 4 lines
    const outputsList = isOutputWindow() ? get(allOutputs) : get(outputs)
    const amountOfLinesToShow: number = getFewestOutputLines(outputsList)
    const { start, end } = getOutputLineWindow({
        line: outSlide.line || 0,
        maxLines,
        styleLines: maxStyleLines,
        amountOfLinesToShow,
        highestLinePos: getHighestOutputLinePos()
    })

    // if the value is 3 & 2 lines, with slide text of 6 lines, the center will not match, but I probably can't do anything about that

    // lines reveal
    const linesRevealItems = (showSlide?.items || []).filter((a) => a?.lineReveal)
    const currentReveal = outSlide.revealCount ?? 0
    let linesStart: number | null = null
    let linesEnd: number | null = null
    if (linesRevealItems.length) {
        const revealWindow = getRevealLineWindow(currentReveal, maxStyleLines)
        linesStart = revealWindow.start
        linesEnd = revealWindow.end
    }

    return {
        start: !!maxStyleLines ? start : null,
        end: !!maxStyleLines ? end : null,
        linesStart: !!linesRevealItems.length ? linesStart : null,
        linesEnd: !!linesRevealItems.length ? linesEnd : null,
        clickRevealed
    } // , index: linesIndex, max: maxStyleLines
}

function getHighestOutputLinePos() {
    const outputsList = isOutputWindow() ? get(allOutputs) : get(outputs)
    const outputIds = getActiveOutputs(outputsList, true, true, true)
    let highestLine = 0
    outputIds.forEach((outputId) => {
        const outputSlide = outputsList[outputId]?.out?.slide
        const line = Number(outputSlide?.line || 0)
        if (line > highestLine) highestLine = line
    })
    return highestLine
}

// METADATA

// WIP dynamic placeholder values??: {meta_title?No title}
export const DEFAULT_META_LAYOUT = "Title: {meta_title?No title}; {meta_artist}; {meta_author}; {meta_year};\n{meta_copyright}"
export function createMetadataLayout(layout: string, ref: any, _updater = 0) {
    return replaceDynamicValues(layout, ref)
}

export interface OutputMetadata {
    display?: string
    style?: string
    transition?: any
    value?: string
    media?: boolean
    condition?: any
}
const defaultMetadataItemStyle = "top: 910px;left: 30px;width: 1860px;height: 150px;"
const defaultMetadataTextStyle = "font-size: 30px;color: rgb(255 255 255 / 0.8);text-shadow: 2px 2px 4px rgb(0 0 0 / 80%);"
export function getMetadata(show: Show | undefined, currentStyle: Styles, outSlide: OutSlide | null, _updater = get(templates)) {
    if (!show || !outSlide) return null

    const showCategory = get(categories)[show.category || ""] || {}
    const metadataValues = currentStyle.metadata || showCategory.metadata || {}
    const display = metadataValues.display || "never"
    if (typeof display !== "string" || display === "never") return null

    const ref = clone(_show(outSlide.id).layouts([outSlide.layout]).ref()[0] || [])
    const firstActiveSlideIndex = ref.findIndex((a) => !a.data.disabled)
    const lastActiveSlideIndex = ref.length - 1 - [...ref].reverse().findIndex((a) => !a.data.disabled)
    const displayMetadata = display === "always" || (display.includes("first") && outSlide?.index === firstActiveSlideIndex) || (display.includes("last") && outSlide?.index === lastActiveSlideIndex)
    if (!displayMetadata) return null

    // template
    let templateId: string = metadataValues.template || "metadata"
    // if first slide
    if (display === "first_last" && outSlide?.index === firstActiveSlideIndex) templateId = metadataValues.templateFirst || templateId
    if (display === "always") {
        templateId = metadataValues.templateAll || "metadata"
        // if first slide
        if (outSlide?.index === firstActiveSlideIndex) templateId = metadataValues.templateFirst || templateId
        else if (metadataValues.template && outSlide) {
            // if last slide
            if (outSlide?.index === lastActiveSlideIndex) templateId = metadataValues.template
        }
    }
    if (!get(templates)[templateId]) templateId = "metadata"

    const template = new TemplateHelper(templateId)
    const items = template.getItems()

    const hasDynamicValues = template.getPlainText().includes("{")
    if (!hasDynamicValues) {
        const value = joinMetadata(show.meta, "; ") || get(customMessageCredits)
        const textboxItem = items.findIndex((a) => a.lines)
        if (textboxItem === -1) {
            items.push({ style: defaultMetadataItemStyle, type: "text", lines: [{ align: "", text: [{ value, style: defaultMetadataTextStyle }] }] })
            return items
        } else {
            if (!items[textboxItem].lines?.[0].text?.[0]) items[textboxItem].lines = [{ align: "", text: [{ value, style: defaultMetadataTextStyle }] }]
            else items[textboxItem].lines![0].text![0].value = value
        }
    }

    return items
}
export function joinMetadata(metadata: { [key: string]: string }, divider = "; ") {
    return Object.values(metadata)
        .filter((a: string) => a.length)
        .join(divider)
}

export function getSlideFilter(slideData: SlideData | null) {
    return slideData?.filter ? "filter: " + slideData.filter + ";" : ""
    // let slideFilter = ""

    // if (!slideData) return slideFilter
    // if (Array.isArray(slideData.filterEnabled) && !slideData.filterEnabled?.includes("background")) return slideFilter

    // if (slideData.filter) slideFilter += "filter: " + slideData.filter + ";"
    // if (slideData["backdrop-filter"]) slideFilter += "backdrop-filter: " + slideData["backdrop-filter"] + ";"

    // return slideFilter
}

export function getBlending() {
    const blending = Object.values(get(outputs))[0]?.blending
    if (!blending) return ""

    if (!blending.left && !blending.right) return ""

    const opacity = (blending.opacity ?? 50) / 100
    const center = 50 + Number(blending.offset || 0)
    if (blending.centered) return `-webkit-mask-image: linear-gradient(${blending.rotate ?? 90}deg, rgb(0, 0, 0) ${center - blending.left}%, rgba(0, 0, 0, ${opacity}) ${center}%, rgb(0, 0, 0) ${center + Number(blending.right)}%);`
    return `-webkit-mask-image: linear-gradient(${blending.rotate ?? 90}deg, rgba(0, 0, 0, ${opacity}) 0%, rgb(0, 0, 0) ${blending.left}%, rgb(0, 0, 0) ${100 - blending.right}%, rgba(0, 0, 0, ${opacity}) 100%);`
}

export async function checkFFmpeg(): Promise<boolean> {
    const result = await requestMain(Main.FFMPEG_CHECK)
    if (result?.installed) return true

    if (await confirmCustom("To create an RTMP output, FreeShow needs to download and install FFmpeg. Do you want to proceed?")) {
        const downloadResult = await requestMain(Main.FFMPEG_DOWNLOAD)
        if (downloadResult?.success) {
            newToast("FFmpeg installed successfully!")
            sendMain(Main.ENCODER_DETECT)
            return true
        }

        newToast(translateText("Failed to download FFmpeg: ") + (downloadResult?.error || "Unknown error"))
    }

    return false
}

export function startStreaming(outputId = "") {
    const outputIds = outputId ? [outputId] : getAllActiveOutputIds()
    outputIds.forEach((id) => updateOutputWebrtcData(id, "streaming", true))
}

export async function stopStreaming(outputId = "", confirmStop = false) {
    if (confirmStop && !(await confirmCustom(translateText("output.confirm_stop")))) return
    const outputIds = outputId ? [outputId] : getAllActiveOutputIds()
    outputIds.forEach((id) => updateOutputWebrtcData(id, "streaming", false))
}

export function updateOutputWebrtcData(outputId: string, key: string, value: any) {
    const output = get(outputs)[outputId]
    if (!output) return null
    const newData = { ...(output.webrtcData || {}), [key]: value }
    if (key === "streaming" && (!output.webrtc || !output.webrtcData?.url)) return null
    updateOutputs((allOutputs: any) => {
        if (allOutputs[outputId]) allOutputs[outputId].webrtcData = newData
        return allOutputs
    })
    if (key === "streaming") value ? AudioAnalyser.recorderActivate() : AudioAnalyser.recorderDeactivate()
    send(OUTPUT, ["SET_VALUE"], { id: outputId, key: "webrtcData", value: newData })
    return newData
}

export function startRtmpStreaming(outputId = "") {
    const outputIds = outputId ? [outputId] : getAllActiveOutputIds()
    outputIds.forEach((id) => updateOutputRtmpData(id, "streaming", true))
}

export async function stopRtmpStreaming(outputId = "", confirmStop = false) {
    if (confirmStop && !(await confirmCustom(translateText("output.confirm_stop")))) return
    const outputIds = outputId ? [outputId] : getAllActiveOutputIds()
    outputIds.forEach((id) => updateOutputRtmpData(id, "streaming", false))
}

export function updateOutputRtmpData(outputId: string, key: string, value: any) {
    const output = get(outputs)[outputId]
    if (!output) return null
    const newData = { ...(output.rtmpData || {}), [key]: value }
    if (key === "streaming" && (!output.rtmp || !hasStreamableDestination(newData))) return null
    updateOutputs((allOutputs: any) => {
        if (allOutputs[outputId]) allOutputs[outputId].rtmpData = newData
        return allOutputs
    })
    if (key === "streaming") value ? AudioAnalyser.recorderActivate() : AudioAnalyser.recorderDeactivate()
    send(OUTPUT, ["SET_VALUE"], { id: outputId, key: "rtmpData", value: newData })
    return newData
}

export function addRtmpDestination(outputId: string) {
    const existing = get(outputs)[outputId]?.rtmpData?.destinations || []
    updateOutputRtmpData(outputId, "destinations", [...existing, createDestination()])
}

export function updateRtmpDestination(outputId: string, destinationId: string, key: keyof RtmpDestination, value: any) {
    const existing = get(outputs)[outputId]?.rtmpData?.destinations || []
    updateOutputRtmpData(
        outputId,
        "destinations",
        existing.map((destination) => (destination.id === destinationId ? { ...destination, [key]: value } : destination))
    )
}

export function removeRtmpDestination(outputId: string, destinationId: string) {
    const existing = get(outputs)[outputId]?.rtmpData?.destinations || []
    updateOutputRtmpData(
        outputId,
        "destinations",
        existing.filter((destination) => destination.id !== destinationId)
    )
}
