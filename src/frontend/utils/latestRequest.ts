export type LatestRequest = {
    isCurrent: () => boolean
}

export function createLatestRequest() {
    let generation = 0

    return {
        start(): LatestRequest {
            const requestGeneration = ++generation
            return { isCurrent: () => requestGeneration === generation }
        },
        invalidate() {
            generation++
        }
    }
}
