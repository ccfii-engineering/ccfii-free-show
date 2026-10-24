import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
    function store(value: any) {
        return {
            value,
            set(next: any) {
                this.value = next
            },
            update(update: (value: any) => any) {
                this.value = update(this.value)
            }
        }
    }

    return {
        media: store({}),
        outputs: store({}),
        playerVideos: store({}),
        playingVideos: store([]),
        playingVideoState: store({}),
        special: store({ optimizedMode: false, muteAudioWhenVideoPlays: false }),
        transitionData: store({ media: { duration: 200 } }),
        transport: [] as any[],
        attach: vi.fn(async (...args: any[]) => args),
        detach: vi.fn(),
        hasSource: vi.fn(() => false),
        recorderActivate: vi.fn(),
        setSourceVolume: vi.fn(),
        setTempo: vi.fn(),
        setPitch: vi.fn(),
        updateSource: vi.fn(),
        fadeInAudio: vi.fn(),
        fadeOutAudio: vi.fn(),
        clearMergedDbs: vi.fn(),
        requestMain: vi.fn(async () => null),
        locateMediaFile: vi.fn(async (path: string) => ({ path })),
        customActionActivation: vi.fn()
    }
})

vi.mock("svelte/store", () => ({ get: (value: any) => value.value }))
vi.mock("../../src/types/Channels", () => ({ OUTPUT: "OUTPUT" }))
vi.mock("../../src/types/IPC/Main", () => ({ Main: { READ_AUDIO_METADATA: "READ_AUDIO_METADATA" } }))
vi.mock("../../src/frontend/stores", () => ({
    media: mocks.media,
    outputs: mocks.outputs,
    playerVideos: mocks.playerVideos,
    playingVideos: mocks.playingVideos,
    playingVideoState: mocks.playingVideoState,
    special: mocks.special,
    transitionData: mocks.transitionData
}))
vi.mock("../../src/frontend/audio/audioAnalyser", () => ({
    AudioAnalyser: {
        attach: mocks.attach,
        detach: mocks.detach,
        hasSource: mocks.hasSource,
        recorderActivate: mocks.recorderActivate,
        setSourceVolume: mocks.setSourceVolume,
        setTempo: mocks.setTempo,
        setPitch: mocks.setPitch,
        updateSource: mocks.updateSource
    }
}))
vi.mock("../../src/frontend/audio/audioFading", () => ({ fadeinAllPlayingAudio: mocks.fadeInAudio, fadeoutAllPlayingAudio: mocks.fadeOutAudio }))
vi.mock("../../src/frontend/audio/routing/audioInputCapture", () => ({ AudioInputCapture: { getInstance: () => ({ clearMergedDbs: mocks.clearMergedDbs }) } }))
vi.mock("../../src/frontend/IPC/main", () => ({ requestMain: mocks.requestMain }))
vi.mock("../../src/frontend/outputState/playbackStore", () => ({ getPlaybackSnapshot: () => null, publishPlaybackReport: vi.fn() }))
vi.mock("../../src/frontend/utils/shortcuts", () => ({ playFolder: vi.fn() }))
vi.mock("../../src/frontend/utils/request", () => ({ send: (...args: any[]) => mocks.transport.push(args) }))
vi.mock("../../src/frontend/components/actions/actions", () => ({ customActionActivation: mocks.customActionActivation }))
vi.mock("../../src/frontend/components/drawer/player/playerHelper", () => ({ getVimeoData: vi.fn(), getYouTubeData: vi.fn() }))
vi.mock("../../src/frontend/components/helpers/array", () => ({ clone: (value: any) => structuredClone(value) }))
vi.mock("../../src/frontend/components/helpers/media", () => ({
    downloadOnlineMedia: vi.fn(async (path: string) => path),
    encodeFilePath: (path: string) => path,
    getExtension: (path: string) => path.split(".").pop() || "",
    getMediaType: () => "video",
    locateMediaFile: mocks.locateMediaFile
}))
vi.mock("../../src/frontend/components/helpers/output", () => ({ getAllOutputs: () => [] }))
vi.mock("../../src/frontend/components/helpers/showActions", () => ({ checkNextAfterMedia: vi.fn(async () => false) }))
vi.mock("../../src/frontend/components/output/clear", () => ({ clearBackground: vi.fn() }))

import { outputs, playingVideos, playingVideoState, transitionData } from "../../src/frontend/stores"
import { VideoPlayer } from "../../src/frontend/components/media/video/videoPlayer"

class FakeAudio {
    static instances: FakeAudio[] = []
    currentTime = 0
    duration = 5
    paused = true
    loop = false
    muted = false
    volume = 1
    playbackRate = 1
    src = ""
    playCount = 0
    pauseCount = 0
    private listeners = new Map<string, Array<{ listener: (event: any) => void; once: boolean }>>()

    constructor() {
        FakeAudio.instances.push(this)
    }

    addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }) {
        const listeners = this.listeners.get(type) || []
        listeners.push({ listener, once: !!options?.once })
        this.listeners.set(type, listeners)
    }

    dispatch(type: string) {
        const listeners = this.listeners.get(type) || []
        this.listeners.set(
            type,
            listeners.filter((entry) => !entry.once)
        )
        listeners.forEach((entry) => entry.listener({ type }))
    }

    play() {
        this.playCount++
        this.paused = false
        return Promise.resolve()
    }

    pause() {
        this.pauseCount++
        this.paused = true
    }
}

const path = "/media/shared.webm"

function output(backgroundPath: string, loop = false, muted = false) {
    return { out: { background: { path: backgroundPath, loop, muted } } }
}

function setOutputs(entries: Record<string, any>) {
    outputs.set(entries)
}

function sentData() {
    return mocks.transport.filter((entry) => entry[0] === "OUTPUT" && entry[1][0] === "DATA").map((entry) => entry[2])
}

function sentTimes() {
    return mocks.transport.filter((entry) => entry[0] === "OUTPUT" && entry[1][0] === "TIME").map((entry) => entry[2])
}

beforeEach(() => {
    vi.useRealTimers()
    mocks.transport.length = 0
    mocks.attach.mockClear()
    mocks.detach.mockClear()
    mocks.hasSource.mockReset().mockReturnValue(false)
    mocks.recorderActivate.mockClear()
    mocks.setSourceVolume.mockClear()
    mocks.fadeInAudio.mockClear()
    mocks.fadeOutAudio.mockClear()
    mocks.clearMergedDbs.mockClear()
    mocks.requestMain.mockClear()
    mocks.locateMediaFile.mockClear()
    mocks.customActionActivation.mockClear()
    playingVideos.set([])
    playingVideoState.set({})
    transitionData.set({ media: { duration: 200 } })
    setOutputs({ A: output(path), B: output(path), C: output("/media/other.webm"), D: output(path) })
    FakeAudio.instances.length = 0
    ;(globalThis as any).HTMLAudioElement = FakeAudio
    ;(globalThis as any).Audio = FakeAudio
})

afterEach(() => {
    vi.clearAllTimers()
    if ((VideoPlayer as any).syncClockTimer) clearInterval((VideoPlayer as any).syncClockTimer)
    VideoPlayer.isFadingOut.length = 0
    VideoPlayer.isFadingIn.length = 0
    ;(VideoPlayer as any).syncClockTimer = null
    ;(VideoPlayer as any).isStarting.clear()
    ;(VideoPlayer as any).isStopping.clear()
    ;(VideoPlayer as any).isCheckingEnding.clear()
})

describe("VideoPlayer output playback controls", () => {
    it("mutates one selected audio entry and fans pause, seek, and mute only to current linked outputs", () => {
        const audio = new FakeAudio()
        const independentAudio = new FakeAudio()
        audio.paused = false
        independentAudio.paused = false
        const selected = { path, audio: audio as any, linkedOutputIds: ["A", "B", "C"], type: "background" as const, loop: false }
        const independent = { path, audio: independentAudio as any, linkedOutputIds: ["D"], type: "background" as const, loop: false }
        playingVideos.set([selected, independent])

        VideoPlayer.setMute(path, "A", true)
        VideoPlayer.setLoop(path, "A", true)
        VideoPlayer.pause(path, "A")
        VideoPlayer.seekTo(path, "A", 0.4)

        expect(audio.muted).toBe(true)
        expect(audio.loop).toBe(true)
        expect(audio.paused).toBe(true)
        expect(audio.pauseCount).toBe(1)
        expect(audio.currentTime).toBe(0.4)
        expect(independentAudio.muted).toBe(false)
        expect(independentAudio.loop).toBe(false)
        expect(independentAudio.paused).toBe(false)
        expect(independentAudio.pauseCount).toBe(0)
        expect(independentAudio.currentTime).toBe(0)

        expect(sentData()).toEqual([{ A: { identity: path, muted: true }, B: { identity: path, muted: true } }, { A: { identity: path, loop: true } }, { A: { identity: path, paused: true }, B: { identity: path, paused: true } }])
        expect(sentTimes()).toEqual([{ A: { identity: path, time: 0.4 }, B: { identity: path, time: 0.4 } }])

        setOutputs({ A: output("/media/replaced.webm"), B: output(path), C: output("/media/other.webm"), D: output(path) })
        mocks.transport.length = 0
        VideoPlayer.setMute(path, "A", false)
        expect(audio.muted).toBe(true)
        expect(mocks.transport).toEqual([])
    })

    it("keeps item entries on their legacy audio route and allows native background fallback without an audio entry", () => {
        const itemAudio = new FakeAudio()
        const item = { path, audio: itemAudio as any, linkedOutputIds: ["A"], type: "item" as const, loop: false }
        playingVideos.set([item])
        setOutputs({ A: output("/media/unrelated.webm") })

        VideoPlayer.pause(path, "A")
        VideoPlayer.setMute(path, "A", true)
        expect(itemAudio.paused).toBe(true)
        expect(itemAudio.muted).toBe(true)
        expect(mocks.transport).toEqual([])

        playingVideos.set([])
        setOutputs({ A: output(path) })
        VideoPlayer.pause(path, "A")
        VideoPlayer.play(path, "A")
        VideoPlayer.setMute(path, "A", true)
        VideoPlayer.setLoop(path, "A", true)
        VideoPlayer.seekTo(path, "A", 0)

        expect(sentData()).toEqual([{ A: { identity: path, paused: true } }, { A: { identity: path, paused: false } }, { A: { identity: path, muted: true } }, { A: { identity: path, loop: true } }])
        expect(sentTimes()).toEqual([{ A: { identity: path, time: 0 } }])

        mocks.transport.length = 0
        setOutputs({ A: output("/media/replaced.webm") })
        VideoPlayer.pause(path, "A")
        expect(mocks.transport).toEqual([])
    })

    it("does no delayed-start work after the exact entry is removed", async () => {
        vi.useFakeTimers()
        const startPromise = VideoPlayer.start(path, {}, ["A", "B"])
        await Promise.resolve()
        await Promise.resolve()
        const audio = FakeAudio.instances.at(-1)
        expect(audio).toBeDefined()
        audio!.dispatch("canplay")
        await expect(startPromise).resolves.toBe(true)

        expect(playingVideos.value).toHaveLength(1)
        playingVideos.set([])
        const stateBeforeCallback = playingVideoState.value

        await vi.advanceTimersByTimeAsync(100)

        expect(audio!.playCount).toBe(0)
        expect(audio!.volume).toBe(1)
        expect(mocks.attach).not.toHaveBeenCalled()
        expect(mocks.recorderActivate).not.toHaveBeenCalled()
        expect(mocks.customActionActivation).not.toHaveBeenCalled()
        expect(playingVideoState.value).toBe(stateBeforeCallback)
    })

    it("starts on a surviving linked output after another target is replaced during the delay", async () => {
        vi.useFakeTimers()
        const startPromise = VideoPlayer.start(path, {}, ["A", "B"])
        await Promise.resolve()
        await Promise.resolve()
        const audio = FakeAudio.instances.at(-1)
        expect(audio).toBeDefined()
        audio!.dispatch("canplay")
        await expect(startPromise).resolves.toBe(true)

        setOutputs({ A: output("/media/replaced.webm"), B: output(path) })
        await vi.advanceTimersByTimeAsync(70)
        await Promise.resolve()
        await Promise.resolve()

        expect(audio!.playCount).toBe(1)
        expect(playingVideos.value[0].linkedOutputIds).toEqual(["B"])
        expect(mocks.attach).toHaveBeenCalledWith(path, audio, "B")
        expect(mocks.recorderActivate).toHaveBeenCalledOnce()
        expect(sentData()).toEqual([{ B: { identity: path, paused: false } }])
    })
})
