import assert from "node:assert/strict"
import { test } from "node:test"
import { getOutputMediaLoop, toggleMediaLoop } from "../../src/frontend/components/actions/mediaLoopCommand.ts"

function createCommand(background, mirror) {
    const calls = { backgrounds: [], mirrors: [], lookups: [] }
    const result = toggleMediaLoop({
        outputId: "output-1",
        background,
        setBackground(nextBackground) {
            calls.backgrounds.push(nextBackground)
        },
        setOutputLoop(path, outputId, loop) {
            calls.mirrors.push({ path, outputId, loop })
        }
    })

    return { result, calls }
}

test("public loop command enables its output mirror", () => {
    const { result, calls } = createCommand({ path: "/media/clip.webm", loop: false }, { path: "/media/clip.webm", linkedOutputIds: ["output-1"], loop: false })

    assert.equal(result, true)
    assert.deepEqual(calls.backgrounds, [{ path: "/media/clip.webm", loop: true }])
    assert.deepEqual(calls.mirrors, [{ path: "/media/clip.webm", outputId: "output-1", loop: true }])
    assert.deepEqual(calls.lookups, [])
})

test("public loop command disables its output mirror", () => {
    const { result, calls } = createCommand({ id: "/media/clip.webm", loop: true }, { path: "/media/clip.webm", linkedOutputIds: ["output-1"], loop: true })

    assert.equal(result, false)
    assert.deepEqual(calls.backgrounds, [{ id: "/media/clip.webm", loop: false }])
    assert.deepEqual(calls.mirrors, [{ path: "/media/clip.webm", outputId: "output-1", loop: false }])
})

test("applies an absolute loop value when there is no audio mirror", () => {
    const { result, calls } = createCommand({ path: "/media/clip.webm", loop: false }, null)

    assert.equal(result, true)
    assert.deepEqual(calls.mirrors, [{ path: "/media/clip.webm", outputId: "output-1", loop: true }])
})

test("missing loop state agrees with the DOM default", () => {
    const { result, calls } = createCommand({ path: "/media/clip.webm" }, null)

    assert.equal(getOutputMediaLoop({}), false)
    assert.equal(result, true)
    assert.deepEqual(calls.mirrors, [{ path: "/media/clip.webm", outputId: "output-1", loop: true }])
})
