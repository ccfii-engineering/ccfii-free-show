/** Present and extract a known frame from the complete candidate stage. */
export async function presentProbeFrame(PIXI: any, app: any): Promise<boolean> {
    const probe = new PIXI.Graphics().rect(0, 0, 2, 2).fill(0xff00ff)
    app.stage.addChild(probe)
    try {
        app.renderer.render(app.stage)
        const extracted = await app.renderer.extract.pixels({ target: app.stage })
        const pixels: ArrayLike<number> = extracted?.pixels || extracted || []
        for (let index = 0; index + 3 < pixels.length; index += 4) {
            if (pixels[index] > 0 && pixels[index + 2] > 0 && pixels[index + 3] > 0) return true
        }
        return false
    } finally {
        app.stage.removeChild(probe)
        probe.destroy({ children: true })
    }
}
