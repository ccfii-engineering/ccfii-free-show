import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../index", () => ({ toApp: vi.fn() }))
vi.mock("../capture/CaptureHelper", () => ({ CaptureHelper: { updateFramerate: vi.fn() } }))
vi.mock("grandiose", () => ({ FOURCC_BGRA: "BGRA", FOURCC_BGRX: "BGRX", FORMAT_TYPE_PROGRESSIVE: "progressive" }))

import { NdiSender } from "./NdiSender"

describe("NDI sender backpressure", () => {
    beforeEach(() => {
        NdiSender.NDI = {}
    })

    it("keeps one video send in flight and replaces the pending frame with the latest", async () => {
        let releaseFirst!: () => void
        let resolveSecond!: (frame: any) => void
        const firstSend = new Promise<void>((resolve) => (releaseFirst = resolve))
        const secondStarted = new Promise<any>((resolve) => (resolveSecond = resolve))
        const sender = {
            video: vi
                .fn()
                .mockImplementationOnce(() => firstSend)
                .mockImplementationOnce((frame) => {
                    resolveSecond(frame)
                    return Promise.resolve()
                })
        }
        NdiSender.NDI.output = { name: "test output", sender }

        const size = { width: 16, height: 1 }
        const first = Buffer.alloc(64, 1)
        const superseded = Buffer.alloc(64, 2)
        const latest = Buffer.alloc(64, 3)
        const options = { size, ratio: 16, framerate: 30, transparent: true }

        await NdiSender.sendVideoBufferNDI("output", first, options)
        await NdiSender.sendVideoBufferNDI("output", superseded, options)
        await NdiSender.sendVideoBufferNDI("output", latest, options)

        expect(sender.video).toHaveBeenCalledTimes(1)
        expect(NdiSender.NDI.output.pendingVideoFrame.data).toEqual(latest)

        releaseFirst()
        const delivered = await secondStarted
        expect(sender.video).toHaveBeenCalledTimes(2)
        expect(delivered.data).toEqual(latest)
    })
})
