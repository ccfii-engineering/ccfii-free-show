<svelte:options immutable={true} />

<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { OUTPUT } from "../../../../types/Channels"
    import type { OutBackground, Transition } from "../../../../types/Show"
    import { allOutputs, outputs } from "../../../stores"
    import { outputEntry } from "../../../utils/perEntryStores"
    import { send } from "../../../utils/request"
    import { getOutputResolution } from "../../helpers/output"
    import Output from "../Output.svelte"
    import { isPixiSupported, providePixiBackgroundBridge, type PixiBackgroundBridge } from "./pixiBackgroundBridge"

    export let outputId = ""
    export let style = ""

    let canvas: HTMLCanvasElement
    let pixiApp: any = null
    let layerMgr: any = null
    let layerMgrMod: any = null
    let rendererMod: any = null
    let pixiReady = false
    let timeSendingTimeout: NodeJS.Timeout | null = null
    let lastVideoDataSent = ""

    $: myOutput = outputEntry(outputId)
    $: currentOutput = $myOutput || $allOutputs[outputId] || {}
    $: resolution = getOutputResolution(outputId, $outputs, true)

    // Provide the bridge IMMEDIATELY (before onMount) so child Output/Background instances see it
    // on first render. The bridge buffers updates until pixiReady, then flushes them.
    type PendingUpdate = { slot: "style" | "slide"; data: OutBackground | null; transition: Transition }
    const pendingUpdates: PendingUpdate[] = []
    const pendingAnimations: { slot: "style" | "slide"; animationStyle: string }[] = []

    // Debounce null dispatches so transient null states between same-media slides don't destroy
    // Pixi state (same rationale as earlier fix in WebGPUOutput pre-refactor).
    const CLEAR_DEBOUNCE_MS = 120
    let slideBgClearTimer: NodeJS.Timeout | null = null
    let styleBgClearTimer: NodeJS.Timeout | null = null

    const bridge: PixiBackgroundBridge = {
        update(slot, data, transition) {
            if (!isPixiSupported(data?.type)) return false
            if (data) {
                // Non-null dispatch — cancel any pending clear for this slot
                if (slot === "style" && styleBgClearTimer) {
                    clearTimeout(styleBgClearTimer)
                    styleBgClearTimer = null
                }
                if (slot === "slide" && slideBgClearTimer) {
                    clearTimeout(slideBgClearTimer)
                    slideBgClearTimer = null
                }
            }
            if (!pixiReady || !layerMgr || !layerMgrMod) {
                pendingUpdates.push({ slot, data, transition })
                return true
            }
            if (data) {
                if (slot === "style") layerMgrMod.updateStyleBackground(layerMgr, data, transition)
                else layerMgrMod.updateSlideBackground(layerMgr, data, transition)
            } else {
                // Defer clear to absorb reactive transient nulls
                const fire = () => {
                    if (!layerMgr || !layerMgrMod) return
                    if (slot === "style") layerMgrMod.updateStyleBackground(layerMgr, null, {})
                    else layerMgrMod.updateSlideBackground(layerMgr, null, {})
                }
                if (slot === "style" && !styleBgClearTimer) {
                    styleBgClearTimer = setTimeout(() => {
                        styleBgClearTimer = null
                        fire()
                    }, CLEAR_DEBOUNCE_MS)
                } else if (slot === "slide" && !slideBgClearTimer) {
                    slideBgClearTimer = setTimeout(() => {
                        slideBgClearTimer = null
                        fire()
                    }, CLEAR_DEBOUNCE_MS)
                }
            }
            return true
        },
        clear(slot) {
            if (!pixiReady || !layerMgr || !layerMgrMod) return
            if (slot === "style") layerMgrMod.updateStyleBackground(layerMgr, null, {})
            else layerMgrMod.updateSlideBackground(layerMgr, null, {})
        },
        setAnimation(slot, animationStyle) {
            if (!pixiReady || !layerMgr || !layerMgrMod) {
                pendingAnimations.push({ slot, animationStyle })
                return
            }
            if (slot === "style") layerMgrMod.setStyleAnimation(layerMgr, animationStyle)
            else layerMgrMod.setSlideAnimation(layerMgr, animationStyle)
        }
    }
    providePixiBackgroundBridge(bridge)

    onMount(async () => {
        if (!canvas) return
        try {
            const PIXI = await import("pixi.js")
            const initRes = getOutputResolution(outputId, $outputs, true)
            const initW = initRes?.width || 1920
            const initH = initRes?.height || 1080

            const app = new PIXI.Application()
            await app.init({
                canvas,
                width: initW,
                height: initH,
                backgroundColor: 0x000000,
                backgroundAlpha: currentOutput?.transparent ? 0 : 1,
                preference: "webgl",
                resolution: 1
            })
            pixiApp = app

            rendererMod = await import("./PixiRenderer")
            layerMgrMod = await import("./LayerManager")

            const containers = rendererMod.createStageContainers(app)
            // Publish the slide background's video currentTime/duration/paused so MediaControls,
            // remote, and stage display all work for WebGPU outputs. Like BackgroundMedia.svelte,
            // we live in the output window — we send via IPC to the main window where receivers.ts
            // handles MAIN_TIME/MAIN_DATA → videosTime/videosData. Throttled ~220ms to match the
            // regular path.
            const videoTimeHandler = ({ currentTime, duration, paused }: { currentTime: number; duration: number; paused: boolean }) => {
                const nextVideoData = JSON.stringify({ duration, paused })
                if (nextVideoData !== lastVideoDataSent) {
                    lastVideoDataSent = nextVideoData
                    send(OUTPUT, ["MAIN_DATA"], { [outputId]: { duration, paused } })
                }
                if (timeSendingTimeout) return
                send(OUTPUT, ["MAIN_TIME"], { [outputId]: currentTime })
                timeSendingTimeout = setTimeout(() => {
                    timeSendingTimeout = null
                }, 220)
            }
            layerMgr = await layerMgrMod.createLayerManager(app, containers, initW, initH, videoTimeHandler)
            pixiReady = true

            // Flush anything buffered before Pixi was ready
            for (const u of pendingUpdates) bridge.update(u.slot, u.data, u.transition)
            pendingUpdates.length = 0
            for (const a of pendingAnimations) bridge.setAnimation(a.slot, a.animationStyle)
            pendingAnimations.length = 0
        } catch (e) {
            console.error("WebGPUOutput: init failed:", e)
        }
    })

    // Resize Pixi canvas when the output resolution changes
    $: if (pixiReady && layerMgr && layerMgrMod && resolution?.width > 0 && resolution?.height > 0) {
        rendererMod.resizeApp(pixiApp, resolution.width, resolution.height)
        layerMgrMod.resizeAllLayers(layerMgr, resolution.width, resolution.height)
    }

    onDestroy(() => {
        if (slideBgClearTimer) clearTimeout(slideBgClearTimer)
        if (styleBgClearTimer) clearTimeout(styleBgClearTimer)
        if (timeSendingTimeout) clearTimeout(timeSendingTimeout)
        if (layerMgr && layerMgrMod) layerMgrMod.destroyLayerManager(layerMgr)
        if (pixiApp) pixiApp.destroy(true, { children: true, texture: true })
    })
</script>

<Output {outputId} {style}>
    <canvas slot="background" bind:this={canvas} class="pixi-canvas" />
</Output>

<style>
    .pixi-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        pointer-events: none;
    }
</style>
