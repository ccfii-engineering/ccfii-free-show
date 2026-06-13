type VideoLoopSource = { loop?: boolean } | null | undefined

export function isVideoLooping(source: VideoLoopSource): boolean {
    return source?.loop === true
}

export function getToggledVideoLoop(source: VideoLoopSource): boolean {
    return !isVideoLooping(source)
}
