export type VideoControlData = {
    currentTime?: number
    paused?: boolean
    loop?: boolean
    muted?: boolean
}

type ControllableVideo = {
    currentTime: number
    duration: number
    paused: boolean
    loop: boolean
    muted: boolean
    play: () => Promise<void> | void
    pause: () => void
}

export function isVideoTimeReset(currentTime: number, previousTime: number, threshold = 0.5): boolean {
    return Number.isFinite(previousTime) && currentTime < previousTime - threshold
}

export function getVideoControlSnapshot(video: ControllableVideo) {
    return {
        currentTime: video.currentTime || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        loop: video.loop,
        muted: video.muted
    }
}

export async function applyVideoControlData(video: ControllableVideo, data: VideoControlData): Promise<void> {
    if (Number.isFinite(data.currentTime)) video.currentTime = data.currentTime!
    if (data.loop !== undefined) video.loop = !!data.loop
    if (data.muted !== undefined) video.muted = !!data.muted

    if (data.paused === true && !video.paused) {
        video.pause()
    } else if (data.paused === false && video.paused) {
        await Promise.resolve(video.play()).catch((e) => console.warn("Video control play failed:", e))
    }
}
