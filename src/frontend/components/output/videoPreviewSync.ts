export type PreviewVideoSyncInput = {
    fadingOut: boolean
    localPaused: boolean
    localTime: number
    remotePaused?: boolean
    remoteTime?: number
}

export type PreviewVideoSyncUpdate = {
    time: number
    paused: boolean
}

export function getPreviewVideoSyncUpdate({ fadingOut, localPaused, localTime, remotePaused, remoteTime }: PreviewVideoSyncInput): PreviewVideoSyncUpdate | null {
    if (fadingOut || remoteTime === undefined) return null

    const diff = remoteTime - localTime
    const absDiff = Math.abs(diff)
    if (absDiff <= 0.5) return null

    if (!localPaused) {
        const outputMovedBackward = diff < -0.5
        const previewFarBehind = diff > 2
        if (!outputMovedBackward && !previewFarBehind) return null
    }

    return {
        time: remoteTime,
        paused: remotePaused ?? localPaused
    }
}
