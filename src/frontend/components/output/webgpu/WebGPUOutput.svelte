<script lang="ts">
    import { onMount } from "svelte"

    // Accept props from MainOutput (but don't use them yet)
    export let outputId = ""
    export let style = ""

    let canvas: HTMLCanvasElement
    let status = "waiting..."

    onMount(async () => {
        status = "mounting..."

        if (!canvas) {
            status = "ERROR: no canvas"
            return
        }

        try {
            status = "loading pixi..."
            const PIXI = await import("pixi.js")

            status = "creating app..."
            const app = new PIXI.Application()
            await app.init({
                canvas,
                width: 1920,
                height: 1080,
                backgroundColor: 0x000000,
                preference: "webgl",
                resolution: 1
            })

            // Test: draw red rectangle and text
            const rect = new PIXI.Graphics()
            rect.rect(100, 100, 600, 300)
            rect.fill(0xff3333)
            app.stage.addChild(rect)

            const text = new PIXI.Text({ text: `PixiJS Output Ready! (${outputId})`, style: { fill: 0xffffff, fontSize: 48 } })
            text.x = 120
            text.y = 450
            app.stage.addChild(text)

            status = `OK! ${app.renderer.type === 0x02 ? "WebGPU" : "WebGL"} | output: ${outputId}`
        } catch (e) {
            status = "FAILED: " + String(e)
            console.error("WebGPUOutput error:", e)
        }
    })
</script>

<div class="root">
    <p class="status">{status}</p>
    <canvas bind:this={canvas} class="canvas" />
</div>

<style>
    .root {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #000;
    }

    .canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .status {
        position: absolute;
        top: 10px;
        left: 10px;
        color: #0f0;
        font-family: monospace;
        font-size: 18px;
        z-index: 999;
        margin: 0;
    }
</style>
