// setOutput("background") sends the stored `startAt` as a TIME message 600ms after every background update.
// An operator toggle (loop) updates the background of media that is already playing, so it must not carry `startAt`,
// or the video jumps back to its start position.
export function backgroundWithToggle<T extends { startAt?: number }>(background: T, patch: { loop?: boolean; muted?: boolean }): Omit<T, "startAt"> & { loop?: boolean; muted?: boolean } {
    const { startAt: _startAt, ...rest } = background
    return { ...rest, ...patch }
}
