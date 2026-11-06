import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getMedia, getMediaEntry, media, patchMedia, putMedia, removeMedia, selectMediaEntry, setMedia, updateMedia, writableMedia } from "./media.svelte"

beforeEach(() => {
    setMedia({ "/a.mp4": { fit: "cover" }, "/b.png": { fit: "contain" }, "/c.jpg": {} })
})

describe("media domain module", () => {
    it("exposes a read-only store", () => {
        expect(typeof media.subscribe).toBe("function")
        expect((media as any).set).toBeUndefined()
        expect((media as any).update).toBeUndefined()
        expect(Object.keys(get(media))).toEqual(["/a.mp4", "/b.png", "/c.jpg"])
    })

    it("reads one entry by path", () => {
        expect(getMediaEntry("/a.mp4")?.fit).toBe("cover")
        expect(getMediaEntry("/nope")).toBeUndefined()
        expect(getMedia()["/b.png"].fit).toBe("contain")
    })

    it("updateMedia accepts in-place mutation, notifies on real change only", () => {
        const run = vi.fn()
        const stop = media.subscribe(run)
        run.mockClear()
        updateMedia((a) => {
            a["/a.mp4"].fit = "cover"
            return a
        })
        expect(run).not.toHaveBeenCalled()
        updateMedia((a) => {
            a["/a.mp4"].fit = "fill"
            return a
        })
        expect(run).toHaveBeenCalledTimes(1)
        expect(getMediaEntry("/a.mp4")?.fit).toBe("fill")
        stop()
    })

    it("selectMediaEntry wakes only the changed path", () => {
        const a = vi.fn()
        const b = vi.fn()
        const stopA = selectMediaEntry("/a.mp4").subscribe(a)
        const stopB = selectMediaEntry("/b.png").subscribe(b)
        a.mockClear()
        b.mockClear()
        patchMedia("/b.png", { fit: "blur" })
        expect(a).not.toHaveBeenCalled()
        expect(b).toHaveBeenCalledTimes(1)
        stopA()
        stopB()
    })

    it("put/remove and the writable face delegate to the module", () => {
        putMedia("/d.gif", { flipped: true })
        expect(getMediaEntry("/d.gif")?.flipped).toBe(true)
        removeMedia("/d.gif")
        expect(getMediaEntry("/d.gif")).toBeUndefined()
        writableMedia.set({ "/x": {} })
        expect(Object.keys(get(media))).toEqual(["/x"])
        writableMedia.update((a) => {
            a["/x"].flipped = true
            return a
        })
        expect(getMediaEntry("/x")?.flipped).toBe(true)
    })
})
