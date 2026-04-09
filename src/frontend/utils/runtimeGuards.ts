export function hasStageVideoItems(items: Record<string, unknown> | undefined | null): boolean {
    return Object.keys(items || {}).some((id) => id.includes("video"))
}

export function syncEventTargetListeners<T extends { addEventListener: (name: string, handler: EventListenerOrEventListenerObject) => void; removeEventListener: (name: string, handler: EventListenerOrEventListenerObject) => void }>(
    attachedTarget: T | null,
    nextTarget: T | null,
    listeners: Record<string, EventListenerOrEventListenerObject>
): T | null {
    if (attachedTarget === nextTarget) return attachedTarget

    if (attachedTarget) {
        Object.entries(listeners).forEach(([name, handler]) => {
            attachedTarget.removeEventListener(name, handler)
        })
    }

    if (nextTarget) {
        Object.entries(listeners).forEach(([name, handler]) => {
            nextTarget.addEventListener(name, handler)
        })
    }

    return nextTarget
}
