import { describe, expect, it, vi } from "vitest"
import { RemoteMediaViews } from "./remoteMediaViews"

describe("remote media view ownership", () => {
    it("does not let a stale cancel close a newer view on the same socket", () => {
        const views = new RemoteMediaViews()
        const closeBackend = vi.fn()
        const oldRequest = new AbortController()
        const currentRequest = new AbortController()
        views.set("socket", { requestId: "old", path: "/old", activeRequest: oldRequest })
        views.close("socket", undefined, closeBackend)
        expect(oldRequest.signal.aborted).toBe(true)
        closeBackend.mockClear()
        views.set("socket", { requestId: "current", path: "/current", activeRequest: currentRequest })

        const staleCancelHandled = views.close("socket", "old", closeBackend)

        expect(staleCancelHandled).toBe(false)
        expect(closeBackend).not.toHaveBeenCalled()
        expect(currentRequest.signal.aborted).toBe(false)
        expect(views.get("socket")?.requestId).toBe("current")

        expect(views.close("socket", "current", closeBackend)).toBe(true)
        expect(closeBackend).toHaveBeenCalledTimes(1)
        expect(currentRequest.signal.aborted).toBe(true)
        expect(views.get("socket")).toBeUndefined()
    })

    it("aborts the active scan and closes its backend cursor when authorization is revoked", () => {
        const views = new RemoteMediaViews()
        const closeConnection = vi.fn((connectionId: string) => views.close(connectionId, undefined, vi.fn()))
        const activeRequest = new AbortController()
        views.set("revoked-socket", { requestId: "scan", path: "/media", activeRequest })

        views.closeUnauthorized(() => false, closeConnection)

        expect(closeConnection).toHaveBeenCalledWith("revoked-socket")
        expect(activeRequest.signal.aborted).toBe(true)
        expect(views.get("revoked-socket")).toBeUndefined()
    })
})
