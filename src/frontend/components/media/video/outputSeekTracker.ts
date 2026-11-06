// Remembers when an operator seek last reached each output, so the delayed "startAt" time
// that setOutput sends after a background starts cannot overwrite a newer seek.

export function createSeekTracker(clock: () => number = () => Date.now()) {
    const lastSeekAt = new Map<string, number>()
    return {
        now: clock,
        markSeek(outputId: string) {
            lastSeekAt.set(outputId, clock())
        },
        seekedSince(outputId: string, since: number): boolean {
            const seekAt = lastSeekAt.get(outputId)
            return seekAt !== undefined && seekAt >= since
        }
    }
}

export const outputSeekTracker = createSeekTracker()
