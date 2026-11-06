import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// The operator Loop toggle must not rewrite the output background: setOutput("background") re-sends the video data and the
// stored startAt 600ms later, and any outputs-store write for the background drops the playing video back to 0.
// The Playwright check lives in config/testing/output-media-qualification.test.ts (operator loop keeps the position).
test("MediaControls toggleLoop only calls VideoPlayer.setLoop", () => {
    const source = readFileSync("src/frontend/components/output/tools/MediaControls.svelte", "utf8")
    const body = source.slice(source.indexOf("function toggleLoop()"), source.indexOf("function openPreview()"))
    assert.match(body, /VideoPlayer\.setLoop\(/)
    assert.doesNotMatch(body, /setOutput|patchOutput|updateOutputs|putOutput/)
})
