export function shouldHoldVideoSeekCooldown(inCooldown: boolean, isExplicitSeek: boolean, paused: boolean, absDiff: number): boolean {
    return inCooldown && !isExplicitSeek && !(paused && absDiff > 0.05)
}
