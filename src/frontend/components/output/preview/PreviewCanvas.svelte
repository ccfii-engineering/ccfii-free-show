<script lang="ts">
    import { onDestroy, onMount } from "svelte"

    export let capture: any
    export let fullscreen: any = false
    export let disabled: any = false
    export let id = ""
    export let style = ""

    let canvas: any
    let ctx: any
    let width = 0
    let height = 0

    // Offscreen canvas reused across frames — drawing ImageData directly avoids the async
    // createImageBitmap allocation (3 allocs per frame per preview previously).
    let offscreen: HTMLCanvasElement | null = null
    let offscreenCtx: CanvasRenderingContext2D | null = null
    let offscreenW = 0
    let offscreenH = 0

    onMount(() => {
        if (!canvas) return

        ctx = canvas.getContext("2d", { alpha: false })
        canvas.width = width * 2.0
        canvas.height = height * 2.0
    })

    onDestroy(() => {
        offscreen = null
        offscreenCtx = null
    })

    $: if (fullscreen !== "") setTimeout(updateResolution, 100)
    function updateResolution() {
        if (!canvas) return

        // Reduce canvas resolution for better performance in stage layouts
        const multiplier = fullscreen ? 1.2 : 2.0
        canvas.width = width * multiplier
        canvas.height = height * multiplier

        if (capture) updateCanvas()
    }

    // Frame rate limit — non-fullscreen previews don't need 30fps; 20fps is imperceptibly different
    // and cuts the allocation rate by 33%.
    let lastUpdate = 0
    $: frameRateLimit = fullscreen ? 1000 / 30 : 1000 / 20
    $: if (capture) throttledUpdateCanvas()
    function throttledUpdateCanvas() {
        const now = Date.now()
        if (now - lastUpdate < frameRateLimit) return
        lastUpdate = now
        updateCanvas()
    }

    function updateCanvas() {
        if (!canvas || !ctx || !capture) return

        try {
            const w = capture.size.width
            const h = capture.size.height
            if (!w || !h) return

            // Reuse / reallocate offscreen canvas only when size changes
            if (!offscreen || offscreenW !== w || offscreenH !== h) {
                offscreen = document.createElement("canvas")
                offscreen.width = w
                offscreen.height = h
                offscreenCtx = offscreen.getContext("2d", { alpha: false })
                offscreenW = w
                offscreenH = h
            }
            if (!offscreenCtx) return

            // Wrap the incoming buffer in-place — no copy
            const arr = new Uint8ClampedArray(capture.buffer)
            const pixels = new ImageData(arr, w, h)
            offscreenCtx.putImageData(pixels, 0, 0)

            // Scale-blit from offscreen to visible canvas
            ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height)
        } catch (error) {
            console.warn("PreviewCanvas update failed:", error)
        }
    }
</script>

<div class="center" class:fullscreen class:disabled {style} bind:offsetWidth={width} bind:offsetHeight={height}>
    <canvas {id} class:hide={!capture} style="aspect-ratio: {capture?.size?.width || 16}/{capture?.size?.height || 9};" class="previewCanvas" bind:this={canvas} />
</div>

<style>
    .center {
        display: flex;
        align-items: center;
        justify-content: center;

        height: 100%;
        width: 100%;
    }
    .center.fullscreen canvas {
        width: unset;
        height: 100%;
    }

    .hide {
        opacity: 0;
    }

    .center.disabled {
        opacity: 0.5;
    }

    canvas {
        width: 100%;
        aspect-ratio: 16/9;
        background-color: black;
    }
</style>
