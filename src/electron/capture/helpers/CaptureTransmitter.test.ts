import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    getConnections: vi.fn(() => 1),
    getStageStreamSubscriberIds: vi.fn(() => ["stage-client"]),
    toServer: vi.fn(),
    toStageStreamSubscribers: vi.fn(),
    getOutput: vi.fn()
}))

vi.mock("../../blackmagic/BlackmagicSender", () => ({ BlackmagicSender: { canAcceptFrame: vi.fn(() => true), audioQueueLength: 0, scheduleFrame: vi.fn() } }))
vi.mock("../../ndi/NdiSender", () => ({ NdiSender: { NDI: {}, sendVideoBufferNDI: vi.fn() } }))
vi.mock("../../ndi/vingester-util", () => ({ default: { ImageBufferAdjustment: { BGRAtoRGBA: vi.fn(), ARGBtoRGBA: vi.fn() } } }))
vi.mock("../../output/OutputHelper", () => ({ OutputHelper: { getOutput: mocks.getOutput, Send: { sendToWindow: vi.fn() } } }))
vi.mock("../../servers", () => ({
    getConnections: mocks.getConnections,
    getStageStreamSubscriberIds: mocks.getStageStreamSubscriberIds,
    toServer: mocks.toServer,
    toStageStreamSubscribers: mocks.toStageStreamSubscribers
}))
vi.mock("../../streaming/RtmpStreamer", () => ({ RtmpStreamer: { isRunning: vi.fn(() => false), updateFrame: vi.fn() } }))
vi.mock("../../streaming/WebRtcHost", () => ({ WebRtcHost: { isRunning: vi.fn(() => false), sendFrame: vi.fn() } }))
vi.mock("../CaptureHelper", () => ({ CaptureHelper: { getMaxActiveFramerate: vi.fn(() => 30) } }))

import { CaptureTransmitter } from "./CaptureTransmitter"

function image(value: number, size = { width: 1920, height: 1080 }) {
    const bitmap = Buffer.from([value, 2, 3, 255])
    const scaledSize = { width: 1280, height: Math.round((1280 * size.height) / size.width) }
    const scaled = { getSize: () => scaledSize, toJPEG: vi.fn(() => Buffer.from([value])) }
    return {
        getSize: () => size,
        toBitmap: () => Buffer.from(bitmap),
        resize: vi.fn(() => scaled),
        scaled
    } as any
}

describe("capture transmitter compatibility", () => {
    let now = 1000

    beforeEach(() => {
        vi.spyOn(performance, "now").mockImplementation(() => now)
        mocks.getConnections.mockReset().mockReturnValue(1)
        mocks.getStageStreamSubscriberIds.mockReset().mockReturnValue(["stage-client"])
        mocks.toServer.mockReset()
        mocks.toStageStreamSubscribers.mockReset()
        mocks.getOutput.mockReset().mockReturnValue(undefined)
    })

    afterEach(() => vi.restoreAllMocks())

    it("skips unchanged server frames but sends a keepalive after one second", () => {
        const captureId = "keepalive-test"

        CaptureTransmitter.sendBufferToServer(captureId, image(10))
        now += 500
        CaptureTransmitter.sendBufferToServer(captureId, image(10))
        expect(mocks.toServer).toHaveBeenCalledTimes(1)

        now += 500
        CaptureTransmitter.sendBufferToServer(captureId, image(10))
        expect(mocks.toServer).toHaveBeenCalledTimes(2)
        expect(mocks.toServer).toHaveBeenLastCalledWith("OUTPUT_STREAM", expect.objectContaining({ channel: "STREAM" }))
    })

    it("limits stage frame pushes and downsizes wide frames for subscribers", () => {
        const captureId = "stage-cap-test"
        const first = image(10)
        const second = image(11)
        const third = image(12)

        CaptureTransmitter.sendBufferToMain(captureId, first)
        now += 50
        CaptureTransmitter.sendBufferToMain(captureId, second)
        expect(mocks.toStageStreamSubscribers).toHaveBeenCalledTimes(1)

        now += 50
        CaptureTransmitter.sendBufferToMain(captureId, third)
        expect(mocks.toStageStreamSubscribers).toHaveBeenCalledTimes(2)
        expect(first.resize).toHaveBeenCalledWith({ width: 1280, quality: "good" })
        expect(first.scaled.toJPEG).toHaveBeenCalledWith(70)
        expect(mocks.toStageStreamSubscribers.mock.calls[0][0].data.size).toEqual({ width: 1280, height: 720 })
    })
})
