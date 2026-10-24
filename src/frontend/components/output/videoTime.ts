export function isVideoTimeReset(currentTime: number, previousTime: number, threshold = 0.5): boolean {
    return Number.isFinite(previousTime) && currentTime < previousTime - threshold
}
