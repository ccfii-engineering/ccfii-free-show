import assert from "node:assert/strict"
import { test } from "node:test"

import { clearPresentation, nextPresentationMode, resolveVisibleBackgrounds } from "../../src/frontend/components/output/presentationState.ts"

const media = { path: "explicit.jpg" }
const templateMedia = { path: "template.jpg" }
const styleMedia = { path: "style.jpg" }

test("Clear All atomically removes every output layer including locked overlays", () => {
    const output = {
        enabled: true,
        active: true,
        name: "One",
        color: "#fff",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        screen: null,
        out: { presentationMode: "live", background: media, slide: { id: "show", index: 0 }, overlays: ["locked", "ordinary"], effects: ["effect"], transition: { duration: 5 }, refresh: true }
    }

    const cleared = clearPresentation(output)

    assert.deepEqual(cleared.out, { presentationMode: "cleared", background: null, slide: null, overlays: [], effects: [], transition: null })
    assert.notEqual(cleared, output)
    assert.deepEqual(output.out.overlays, ["locked", "ordinary"])
})

test("cleared mode suppresses explicit, template, and style backgrounds", () => {
    assert.deepEqual(resolveVisibleBackgrounds({ presentationMode: "cleared", explicit: media, template: templateMedia, style: styleMedia }), { style: null, content: null })
})

test("live mode preserves template precedence and retains style background", () => {
    assert.deepEqual(resolveVisibleBackgrounds({ presentationMode: "live", explicit: media, template: templateMedia, style: styleMedia }), { style: styleMedia, content: templateMedia })
    assert.deepEqual(resolveVisibleBackgrounds({ presentationMode: "live", explicit: null, template: templateMedia, style: styleMedia }), { style: styleMedia, content: templateMedia })
})

test("new slide or background activates output but overlay-only updates do not", () => {
    assert.equal(nextPresentationMode("cleared", "slide", { id: "show" }), "live")
    assert.equal(nextPresentationMode("cleared", "background", media), "live")
    assert.equal(nextPresentationMode("cleared", "overlays", ["overlay"]), "cleared")
    assert.equal(nextPresentationMode("cleared", "slide", null), "cleared")
})
