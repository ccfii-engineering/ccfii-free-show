export interface VideoSourceToken {
    sourceKey: string
    generation: number
}

export function getVideoSourceKey(path: string, syncPath = ""): string {
    return JSON.stringify([syncPath || path, path])
}

export class VideoPlayFailureGuard {
    private sourceKey = ""
    private generation = 0
    private failed = false
    private nativeErrorHandled = false

    updateSource(sourceKey: string): VideoSourceToken {
        if (sourceKey !== this.sourceKey) {
            this.sourceKey = sourceKey
            this.generation++
            this.failed = false
            this.nativeErrorHandled = false
        }

        return this.token()
    }

    token(): VideoSourceToken {
        return { sourceKey: this.sourceKey, generation: this.generation }
    }

    isCurrent(token: VideoSourceToken): boolean {
        return token.sourceKey === this.sourceKey && token.generation === this.generation
    }

    canAttempt(token: VideoSourceToken): boolean {
        return this.isCurrent(token) && !this.failed
    }

    markFailed(token: VideoSourceToken, errorName = ""): boolean {
        if (!this.isCurrent(token) || errorName === "AbortError" || this.failed) return false

        this.failed = true
        return true
    }

    handleNativeError(token: VideoSourceToken): boolean {
        if (!this.isCurrent(token) || this.nativeErrorHandled) return false

        this.nativeErrorHandled = true
        return true
    }

    invalidate(): void {
        this.sourceKey = ""
        this.generation++
        this.failed = true
        this.nativeErrorHandled = true
    }
}
