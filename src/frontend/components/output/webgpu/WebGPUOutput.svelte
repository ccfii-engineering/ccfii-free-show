<svelte:options immutable={true} />

<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { uid } from "uid"
    import { OUTPUT } from "../../../../types/Channels"
    import type { OutBackground, Transition } from "../../../../types/Show"
    import { allOutputs, outputs } from "../../../stores"
    import { getOutputRenderAuthority } from "../../../outputState/clientRuntime"
    import { registerPlaybackCommandTarget } from "../../../outputState/playbackCommands"
    import { sendPlaybackReport } from "../../../outputState/playbackStore"
    import { outputEntry } from "../../../utils/perEntryStores"
    import { destroy, receive, send } from "../../../utils/request"
    import { getOutputResolution } from "../../helpers/output"
    import Output from "../Output.svelte"
    import type { GPUBackend } from "../gpu/GPUBackend"
    import { destroyPixiApp, initializePixiOutputSession } from "../gpu/PixiOutputSession"
    import { isVideoTimeReset } from "./videoControlState"
    import { isPixiSupported, providePixiBackgroundBridge, type PixiBackgroundBridge } from "./pixiBackgroundBridge"

    export let outputId = ""
    export let style = ""

    let canvas: HTMLCanvasElement
    let pixiApp: any = null
    let layerMgr: any = null
    let layerMgrMod: any = null
    let rendererMod: any = null
    let pixiReady = false
    let gpuBackend: GPUBackend | null = null
    let sessionActive = true
    let timeSendingTimeout: NodeJS.Timeout | null = null
    let lastVideoDataSent = ""
    let lastVideoTimeSent = Number.NaN
    let unregisterCommands: (() => void) | null = null
    // canonical playback ownership: unique per mount so a remount supersedes this generation (#16)
    const playbackSourceId = `gpu-${uid()}`

    $: myOutput = outputEntry(outputId)
    $: currentOutput = $myOutput || $allOutputs[outputId] || {}
    $: resolution = getOutputResolution(outputId, $outputs, true)
    $: presentationCleared = currentOutput.out?.presentationMode === "cleared"
    $: if (presentationCleared) clearPixiImmediately()

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
            if (presentationCleared) {
                cancelPendingSlot(slot)
                if (pixiReady && layerMgr && layerMgrMod) {
                    if (slot === "style") layerMgrMod.updateStyleBackground(layerMgr, null, {})
                    else layerMgrMod.updateSlideBackground(layerMgr, null, {})
                }
                return true
            }
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
            cancelPendingSlot(slot)
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

    function cancelPendingSlot(slot: "style" | "slide") {
        for (let index = pendingUpdates.length - 1; index >= 0; index--) {
            if (pendingUpdates[index].slot === slot) pendingUpdates.splice(index, 1)
        }
        for (let index = pendingAnimations.length - 1; index >= 0; index--) {
            if (pendingAnimations[index].slot === slot) pendingAnimations.splice(index, 1)
        }
        if (slot === "style" && styleBgClearTimer) {
            clearTimeout(styleBgClearTimer)
            styleBgClearTimer = null
        }
        if (slot === "slide" && slideBgClearTimer) {
            clearTimeout(slideBgClearTimer)
            slideBgClearTimer = null
        }
    }

    function clearPixiImmediately() {
        bridge.clear("style")
        bridge.clear("slide")
    }

    let listenerId = ""
    onMount(async () => {
        if (!canvas) return
        listenerId = `WEBGPU_VIDEO_RECEIVE_${outputId}`
        receive(OUTPUT, videoReceiver, listenerId)
        reportRendererStatus("initializing")

        try {
            const PIXI = await import("pixi.js")
            const initRes = getOutputResolution(outputId, $outputs, true)
            const initW = initRes?.width || 1920
            const initH = initRes?.height || 1080

            const initialized = await initializePixiOutputSession({
                PIXI,
                canvas,
                width: initW,
                height: initH,
                transparent: !!currentOutput?.transparent
            })
            const app = initialized.app
            canvas = initialized.canvas
            if (!sessionActive) {
                destroyPixiApp(app)
                return
            }
            pixiApp = app
            gpuBackend = initialized.backend
            canvas.dataset.gpuBackend = gpuBackend

            rendererMod = await import("./PixiRenderer")
            layerMgrMod = await import("./LayerManager")
            if (!sessionActive) return

            const containers = rendererMod.createStageContainers(app)
            // Publish the slide background's video currentTime/duration/paused so MediaControls,
            // remote, and stage display all work for WebGPU outputs. Like BackgroundMedia.svelte,
            // we live in the output window — we send via IPC to the main window where receivers.ts
            // handles MAIN_TIME/MAIN_DATA → videosTime/videosData. Throttled ~220ms to match the
            // regular path.
            const videoTimeHandler = ({ currentTime, duration, paused, loop, muted, identity }: { currentTime: number; duration: number; paused: boolean; loop: boolean; muted: boolean; identity?: string }) => {
                const timeReset = isVideoTimeReset(currentTime, lastVideoTimeSent)
                const nextVideoData = JSON.stringify({ duration, paused, loop, muted })
                const dataChanged = nextVideoData !== lastVideoDataSent

                // canonical per-output playback state (#16) — wraps always get through the time throttle
                if (dataChanged || timeReset || !timeSendingTimeout) {
                    sendPlaybackReport({ outputId, sourceId: playbackSourceId, role: "visual", identity, duration, progress: currentTime, paused, loop, muted, ...(timeReset ? { event: "wrap" } : {}) })
                }

                if (dataChanged) {
                    lastVideoDataSent = nextVideoData
                    send(OUTPUT, ["MAIN_DATA"], { [outputId]: { duration, paused, loop, muted } })
                }
                if (timeSendingTimeout && !timeReset) return
                if (timeSendingTimeout) {
                    clearTimeout(timeSendingTimeout)
                    timeSendingTimeout = null
                }
                send(OUTPUT, ["MAIN_TIME"], { [outputId]: currentTime })
                lastVideoTimeSent = currentTime
                timeSendingTimeout = setTimeout(() => {
                    timeSendingTimeout = null
                }, 220)
            }
            const createdLayerManager = await layerMgrMod.createLayerManager(app, containers, initW, initH, videoTimeHandler, getOutputRenderAuthority)
            if (!sessionActive) {
                layerMgr = createdLayerManager
                await cleanupRendererResources()
                return
            }
            layerMgr = createdLayerManager
            pixiReady = true
            reportRendererStatus("gpu-active", gpuBackend)

            // playback command round-trip (#17): this mount is the owning Render Generation
            unregisterCommands?.()
            unregisterCommands = registerPlaybackCommandTarget(outputId, (command) => {
                layerMgrMod?.applyPlaybackCommand(layerMgr, command)
            })

            // Flush anything buffered before Pixi was ready
            for (const u of pendingUpdates) bridge.update(u.slot, u.data, u.transition)
            pendingUpdates.length = 0
            for (const a of pendingAnimations) bridge.setAnimation(a.slot, a.animationStyle)
            pendingAnimations.length = 0
        } catch (e) {
            await cleanupRendererResources()
            console.error("WebGPUOutput: init failed:", e)
            if (sessionActive) reportRendererStatus("failed", null, e instanceof Error ? e.message : String(e))
        }
    })

    async function cleanupRendererResources() {
        pixiReady = false
        const managerToDestroy = layerMgr
        const managerModule = layerMgrMod
        const appToDestroy = pixiApp
        layerMgr = null
        pixiApp = null
        gpuBackend = null

        try {
            if (managerToDestroy && managerModule) await managerModule.destroyLayerManager(managerToDestroy)
        } catch (error) {
            console.warn("WebGPUOutput: layer cleanup failed:", error)
        } finally {
            if (appToDestroy) destroyPixiApp(appToDestroy)
        }
    }

    function reportRendererStatus(state: "initializing" | "gpu-active" | "failed", backend: GPUBackend | null = null, reason = "") {
        send(OUTPUT, ["OUTPUT_RENDERER_STATUS"], { outputId, sessionId: getOutputRenderAuthority().sessionId, state, ...(backend ? { backend } : {}), ...(reason ? { reason } : {}) })
    }

    const videoReceiver = {
        DATA: (data: any) => {
            const outputData = data?.[outputId]
            if (!outputData || !layerMgr || !layerMgrMod) return

            layerMgrMod.updateSlideVideoData(layerMgr, outputData)
        },
        TIME: (data: any) => {
            const outputTime = data?.[outputId]
            if (!Number.isFinite(outputTime) || !layerMgr || !layerMgrMod) return

            layerMgrMod.updateSlideVideoTime(layerMgr, outputTime)
        }
    }

    // Resize Pixi canvas when the output resolution changes
    $: if (pixiReady && layerMgr && layerMgrMod && resolution?.width > 0 && resolution?.height > 0) {
        rendererMod.resizeApp(pixiApp, resolution.width, resolution.height)
        layerMgrMod.resizeAllLayers(layerMgr, resolution.width, resolution.height)
    }

    onDestroy(() => {
        sessionActive = false
        pixiReady = false
        unregisterCommands?.()
        unregisterCommands = null
        if (listenerId) destroy(OUTPUT, listenerId)
        if (slideBgClearTimer) clearTimeout(slideBgClearTimer)
        if (styleBgClearTimer) clearTimeout(styleBgClearTimer)
        if (timeSendingTimeout) clearTimeout(timeSendingTimeout)
        // Destroy the app even if an async layer import never settles. Any late manager result is
        // independently cleaned by the inactive-session branch above.
        void cleanupRendererResources()
    })
</script>

<div class="gpu-session" data-gpu-session-state={pixiReady ? "gpu-active" : "initializing"}>
    <div class="composed-frame" class:presented={pixiReady}>
        <Output {outputId} {style}>
            <canvas slot="background" bind:this={canvas} class="pixi-canvas" />
        </Output>
    </div>
</div>

<style>
    .gpu-session,
    .composed-frame {
        width: 100%;
        height: 100%;
    }

    .gpu-session {
        background: #000;
    }

    .composed-frame {
        opacity: 0;
    }

    .composed-frame.presented {
        opacity: 1;
    }

    .pixi-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        pointer-events: none;
    }
</style>
