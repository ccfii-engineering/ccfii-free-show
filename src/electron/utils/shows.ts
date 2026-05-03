import path from "path"
import { ToMain } from "../../types/IPC/ToMain"
import type { Show, Shows, TrimmedShow, TrimmedShows } from "../../types/Show"
import { indexerService } from "../indexer/IndexerService"
import { parseShowsFolder } from "../indexer/ShowParser"
import { sendToMain } from "../IPC/main"
import { deleteFile, getDataFolderPath, parseShow, readFileAsync, readFolder, readFolderAsync, renameFileAsync } from "./files"

export function getAllShows() {
    const showsPath = getDataFolderPath("shows")
    const filesInFolder: string[] = readFolder(showsPath).filter((a) => a.includes(".show") && a.length > 5)
    return filesInFolder
}

export async function renameShows(shows: { id: string; name: string; oldName: string }[], filePath: string) {
    await Promise.all(shows.map((show) => checkFile(show)))
    async function checkFile(show: { id: string; name: string; oldName: string }) {
        const oldName = show.oldName + ".show"
        const newName = (show.name || show.id) + ".show"

        await renameFileAsync(filePath, oldName, newName)
    }
}

// WIP duplicate of setShow.ts
export function trimShow(showCache: Show) {
    let show: TrimmedShow | null = null
    if (!showCache) return show

    show = {
        name: showCache.name,
        category: showCache.category,
        timestamps: showCache.timestamps,
        quickAccess: showCache.quickAccess || {}
    }
    if (showCache.origin) show.origin = showCache.origin
    if (showCache.private) show.private = true
    if (showCache.locked) show.locked = true

    return show
}

/// //

// let hasContent = !!Object.values(show.slides).find((slide) => slide.items.find((item) => item.lines?.find((line) => line.text?.find((text) => text.value?.length))))

function showHasLayoutContent(show: Show) {
    return !!Object.values(show.layouts || {}).find((layout) => layout.slides.length)
}

export function getShowTextContent(show: Show) {
    let textContent = ""
    Object.values(show.slides || {}).forEach((slide) => {
        slide.items.forEach((item) => {
            item.lines?.forEach((line) => {
                line.text?.forEach((text) => {
                    textContent += text.value
                })
            })
        })
    })
    return textContent
}

/// //

export function deleteShows(data: { shows: { name: string; id: string }[] }) {
    const deleted: string[] = []

    const showsPath = getDataFolderPath("shows")

    data.shows.forEach(({ id, name }) => {
        name = (name || id) + ".show"
        const showPath: string = path.join(showsPath, name)
        deleteFile(showPath)
        deleted.push(name)
    })

    void refreshAllShows()
    return { deleted }
}

export function deleteShowsNotIndexed(data: { shows: TrimmedShows }) {
    // get all names
    const names: string[] = Object.entries(data.shows).map(([id, { name }]) => (name || id) + ".show")

    const showsPath = getDataFolderPath("shows")

    // list all shows in folder
    const filesInFolder: string[] = readFolder(showsPath)
    if (!filesInFolder.length) return

    const deleted: string[] = []

    for (const name of filesInFolder) checkFile(name)
    function checkFile(name: string) {
        if (names.includes(name) || !name.includes(".show")) return

        const showPath: string = path.join(showsPath, name)
        deleteFile(showPath)
        deleted.push(name)
    }

    return { deleted }
}

export async function refreshAllShows(useWorker = true) {
    const showsPath = getDataFolderPath("shows")

    const merged: TrimmedShows = {}
    const onChunk = (chunk: TrimmedShows) => {
        Object.assign(merged, chunk)
        sendToMain(ToMain.SHOWS_REFRESH_BATCH, { trimmed: chunk })
    }

    if (useWorker) {
        try {
            await indexerService.parseShows(showsPath, 100, onChunk)
        } catch (err) {
            console.error("[indexer] worker parseShows failed, falling back to in-process parse:", err)
            await parseShowsFolder(showsPath, { chunkSize: 100 }, onChunk)
        }
    } else {
        await parseShowsFolder(showsPath, { chunkSize: 100 }, onChunk)
    }

    if (!Object.keys(merged).length) return
    sendToMain(ToMain.REFRESH_SHOWS2, merged)
}

export async function getEmptyShows(data: { cached: Shows }) {
    const showsPath = getDataFolderPath("shows")

    // list all shows in folder
    const filesInFolder: string[] = await readFolderAsync(showsPath)
    if (!filesInFolder.length || filesInFolder.length > 1000) return []

    const emptyShows: { id: string; name: string }[] = []

    for (const name of filesInFolder) await loadFile(name)
    async function loadFile(name: string) {
        if (!name.includes(".show")) return

        const showPath: string = path.join(showsPath, name)
        const show = parseShow(await readFileAsync(showPath))
        if (!show || !show[1]) return

        // replace stored data with new unsaved cached data
        if (data.cached?.[show[0]]) show[1] = data.cached[show[0]]
        // check that it is empty
        if (showHasLayoutContent(show[1]) || getShowTextContent(show[1]).length) return

        emptyShows.push({ id: show[0], name: name.replace(".show", "") })
    }

    return emptyShows
}
