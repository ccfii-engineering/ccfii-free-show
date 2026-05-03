import fs from "fs"
import path from "path"
import type { Show, TrimmedShow, TrimmedShows } from "../../types/Show"

export type ParseShowsOptions = { chunkSize?: number }
export type ParseShowsCallback = (chunk: TrimmedShows) => void

const DEFAULT_CHUNK_SIZE = 100

function readFileAsync(p: string): Promise<string | null> {
    return new Promise((resolve) => fs.readFile(p, "utf8", (err, data) => resolve(err ? null : data)))
}

function readdirAsync(p: string): Promise<string[]> {
    return new Promise((resolve) => fs.readdir(p, (err, names) => resolve(err ? [] : names)))
}

function trimShow(show: Show): TrimmedShow | null {
    if (!show) return null
    const trimmed: TrimmedShow = {
        name: show.name,
        category: show.category,
        timestamps: show.timestamps,
        quickAccess: show.quickAccess || {}
    }
    if (show.origin) trimmed.origin = show.origin
    if (show.private) trimmed.private = true
    if (show.locked) trimmed.locked = true
    return trimmed
}

function safeParse(content: string): [string, Show] | null {
    try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]) return parsed as [string, Show]
    } catch {
        return null
    }
    return null
}

export async function parseShowsFolder(folder: string, opts: ParseShowsOptions, onChunk: ParseShowsCallback): Promise<void> {
    const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
    const names = (await readdirAsync(folder)).filter((n) => n.endsWith(".show") && n.length > 5)
    if (!names.length) return

    let buffer: TrimmedShows = {}
    let bufferCount = 0

    for (const name of names) {
        const content = await readFileAsync(path.join(folder, name))
        if (!content) continue
        const show = safeParse(content)
        if (!show) continue

        const trimmed = trimShow({ ...show[1], name: name.replace(".show", "") })
        if (!trimmed) continue

        buffer[show[0]] = trimmed
        bufferCount++

        if (bufferCount >= chunkSize) {
            onChunk(buffer)
            buffer = {}
            bufferCount = 0
            await new Promise<void>((r) => setImmediate(r))
        }
    }

    if (bufferCount > 0) onChunk(buffer)
}
