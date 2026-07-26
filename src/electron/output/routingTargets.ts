export function removeRoutingTarget(targets: string[], target: string): boolean {
    const index = targets.indexOf(target)
    if (index < 0) return false
    targets.splice(index, 1)
    return true
}
