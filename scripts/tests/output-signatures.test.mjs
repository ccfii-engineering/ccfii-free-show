import assert from "node:assert/strict"
import { test } from "node:test"
import { getCurrentLineMap, getCurrentLineSignature, getIdArraySignature, getOutSlideSignature, getOutputReceiverSignature, getSelectedEntriesSignature } from "../../src/frontend/utils/outputSignatures.ts"

test("current line signature ignores unrelated line entries", () => {
    const linesA = {
        song1: { start: 1, end: 2 },
        song2: { start: 5, end: 6 }
    }
    const linesB = {
        song1: { start: 1, end: 2 },
        song2: { start: 7, end: 8 }
    }

    assert.equal(getCurrentLineSignature(linesA, "song1"), getCurrentLineSignature(linesB, "song1"))
})

test("current line map includes only the targeted line entry", () => {
    const lines = {
        song1: { start: 1, end: 2 },
        song2: { start: 5, end: 6 }
    }

    assert.deepEqual(getCurrentLineMap(lines, "song1"), { song1: { start: 1, end: 2 } })
    assert.deepEqual(getCurrentLineMap(lines, undefined), {})
})

test("selected entries signature ignores unrelated map entries", () => {
    const mapA = {
        a: { name: "One" },
        b: { name: "Two" }
    }
    const mapB = {
        a: { name: "One" },
        b: { name: "Changed" }
    }

    assert.equal(getSelectedEntriesSignature(mapA, ["a"]), getSelectedEntriesSignature(mapB, ["a"]))
    assert.notEqual(getSelectedEntriesSignature(mapA, ["b"]), getSelectedEntriesSignature(mapB, ["b"]))
})

test("id array signature tracks order and values", () => {
    assert.equal(getIdArraySignature(["a", "b"]), getIdArraySignature(["a", "b"]))
    assert.notEqual(getIdArraySignature(["a", "b"]), getIdArraySignature(["b", "a"]))
})

test("output receiver signature ignores active flag noise", () => {
    const payloadA = { out1: { active: true, out: { slide: { id: "s1" } } } }
    const payloadB = { out1: { active: false, out: { slide: { id: "s1" } } } }

    assert.equal(getOutputReceiverSignature(payloadA, "out1"), getOutputReceiverSignature(payloadB, "out1"))
})

test("out slide signature ignores transient reveal fields", () => {
    const slideA = { id: "slide-1", index: 2, line: "a", revealCount: 1, itemClickReveal: true }
    const slideB = { id: "slide-1", index: 2, line: "b", revealCount: 9, itemClickReveal: false }

    assert.equal(getOutSlideSignature(slideA), getOutSlideSignature(slideB))
})
