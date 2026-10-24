import assert from "node:assert/strict"
import { test } from "node:test"
import { getVideoSourceKey, VideoPlayFailureGuard } from "../../src/frontend/components/media/video/playFailureGuard.ts"

test("blocks repeated play attempts and forwards only one native error per source", () => {
    const guard = new VideoPlayFailureGuard()
    const token = guard.updateSource(getVideoSourceKey("/media/unsupported.avi"))

    assert.equal(guard.canAttempt(token), true)
    assert.equal(guard.markFailed(token, "NotSupportedError"), true)
    assert.equal(guard.canAttempt(token), false)
    assert.equal(guard.markFailed(token, "NotSupportedError"), false)
    assert.equal(guard.handleNativeError(token), true)
    assert.equal(guard.handleNativeError(token), false)
})

test("keeps AbortError retryable", () => {
    const guard = new VideoPlayFailureGuard()
    const token = guard.updateSource(getVideoSourceKey("/media/clip.webm"))

    assert.equal(guard.markFailed(token, "AbortError"), false)
    assert.equal(guard.canAttempt(token), true)
})

test("source changes and stale play rejections do not poison the active source", () => {
    const guard = new VideoPlayFailureGuard()
    const originalKey = getVideoSourceKey("/media/clip.webm")
    const firstAttempt = guard.updateSource(originalKey)

    const replacementKey = getVideoSourceKey("/media/replacement.webm")
    const replacement = guard.updateSource(replacementKey)
    assert.notEqual(replacement.generation, firstAttempt.generation)
    assert.equal(guard.canAttempt(replacement), true)
    assert.equal(guard.markFailed(firstAttempt, "NotSupportedError"), false)

    // Returning to the same path creates a new generation, so old A attempts stay stale.
    const returnedSource = guard.updateSource(originalKey)
    assert.notEqual(returnedSource.generation, firstAttempt.generation)
    assert.equal(guard.canAttempt(returnedSource), true)
    assert.equal(guard.markFailed(firstAttempt, "NotSupportedError"), false)
})

test("destruction invalidates pending attempts", () => {
    const guard = new VideoPlayFailureGuard()
    const token = guard.updateSource(getVideoSourceKey("/media/clip.webm"))

    guard.invalidate()

    assert.equal(guard.isCurrent(token), false)
    assert.equal(guard.markFailed(token, "NotSupportedError"), false)
    assert.equal(guard.handleNativeError(token), false)
})
