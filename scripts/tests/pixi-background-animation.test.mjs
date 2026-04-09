import assert from "node:assert/strict"
import { test } from "node:test"
import { parseAnimationStyle } from "../../src/frontend/components/output/webgpu/backgroundAnimation.ts"

test("empty string → identity", () => {
    const r = parseAnimationStyle("")
    assert.equal(r.scale, 1)
    assert.equal(r.translateX, 0)
    assert.equal(r.translateY, 0)
    assert.equal(r.rotation, 0)
    assert.equal(r.duration, 0)
})

test("null → identity", () => {
    const r = parseAnimationStyle(null)
    assert.equal(r.scale, 1)
    assert.equal(r.duration, 0)
})

test("parses scale(1.3)", () => {
    const r = parseAnimationStyle("transform: scale(1.3);")
    assert.equal(r.scale, 1.3)
})

test("parses translate(-50%, -75%) scale(1.4)", () => {
    const r = parseAnimationStyle("transform: translate(-50%, -75%) scale(1.4);")
    assert.equal(r.translateX, -50)
    assert.equal(r.translateY, -75)
    assert.equal(r.scale, 1.4)
})

test("parses rotate(45deg)", () => {
    const r = parseAnimationStyle("transform: rotate(45deg);")
    assert.ok(Math.abs(r.rotation - Math.PI / 4) < 1e-6)
})

test("parses transition duration (seconds)", () => {
    const r = parseAnimationStyle("transform: scale(1.2);transition: transform 5s ease;")
    assert.equal(r.duration, 5000)
})

test("parses transition duration (ms)", () => {
    const r = parseAnimationStyle("transform: scale(1.2);transition: transform 1500ms ease;")
    assert.equal(r.duration, 1500)
})

test("parses combined transform-origin: center + scale", () => {
    const r = parseAnimationStyle("transform-origin: center;transform: scale(1);")
    assert.equal(r.scale, 1)
    assert.equal(r.translateX, 0)
    assert.equal(r.translateY, 0)
})

test("parses filter", () => {
    const r = parseAnimationStyle("filter: blur(5px) brightness(0.8);")
    assert.equal(r.filter, "blur(5px) brightness(0.8)")
})

test("parses ken-burns style from animation.ts (translate + scale + transition)", () => {
    // Example emitted by src/frontend/components/output/animation.ts change() for background zoom
    const r = parseAnimationStyle("transform-origin: center;transform: translate(-60%, -55%) scale(1.3);transition: transform 10s ease;")
    assert.equal(r.scale, 1.3)
    assert.equal(r.translateX, -60)
    assert.equal(r.translateY, -55)
    assert.equal(r.duration, 10000)
    assert.equal(r.easing, "ease")
})

test("easing defaults to linear when not specified", () => {
    const r = parseAnimationStyle("transform: scale(1.1);")
    assert.equal(r.easing, "linear")
})
