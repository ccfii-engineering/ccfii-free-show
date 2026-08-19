export function isVideoSource(path: string, type: string | undefined): boolean {
    if (type === "video") return true
    const cleanPath = path.split(/[?#]/, 1)[0]
    const extension = cleanPath.split(".").pop()?.toLowerCase() || ""
    return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(extension)
}
