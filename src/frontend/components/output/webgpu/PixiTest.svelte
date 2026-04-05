<script lang="ts">
    import { onMount } from "svelte"

    let canvas: HTMLCanvasElement
    let status = "waiting..."

    onMount(async () => {
        status = "mounting..."

        if (!canvas) {
            status = "ERROR: no canvas"
            return
        }

        status = "canvas found, importing PixiJS..."

        try {
            const PIXI = await import("pixi.js")
            status = "PixiJS loaded, creating app..."

            const app = new PIXI.Application()
            await app.init({
                canvas,
                width: 800,
                height: 600,
                backgroundColor: 0x1a1a2e,
                preference: "webgl",
                resolution: 1
            })

            status = "PixiJS initialized! Drawing..."

            // Draw a red rectangle
            const rect = new PIXI.Graphics()
            rect.rect(50, 50, 300, 200)
            rect.fill(0xff3333)
            app.stage.addChild(rect)

            // Draw text
            const text = new PIXI.Text({ text: "PixiJS is working!", style: { fill: 0xffffff, fontSize: 48 } })
            text.x = 100
            text.y = 300
            app.stage.addChild(text)

            status = `OK! Renderer: ${app.renderer.type === 0x02 ? "WebGPU" : "WebGL"}`
        } catch (e) {
            status = "INIT FAILED: " + String(e)
            console.error("PixiTest error:", e)
        }
    })
</script>

<div class="test-root">
    <p class="status">{status}</p>
    <canvas bind:this={canvas} style="width: 800px; height: 600px; border: 2px solid red;" />
</div>

<style>
    .test-root {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #000;
    }

    .status {
        color: #0f0;
        font-family: monospace;
        font-size: 20px;
        margin-bottom: 10px;
    }
</style>
