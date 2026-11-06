import { get } from "svelte/store"
import { uid } from "uid"
import type { OutData } from "../../types/Output"
import type { OutSlide, Show } from "../../types/Show"
import type { RemoteMediaErrorCode } from "../../types/remote/control"
import type { RemoteOutSlide, RemoteOutTemp, RemotePasswordInfo, RemoteProject, RemoteProtocol, RemoteScriptureResponse, RemoteScriptureSearchResponse, RemoteShow } from "../../types/remote/protocol"
import type { WebHandlerTable } from "../../types/WebProtocol"
import { Main } from "../../types/IPC/Main"
import { loadJsonBible } from "../components/drawer/bible/scripture"
import { clone, keysToID, removeDeleted } from "../components/helpers/array"
import { getThumbnailPath, mediaSize } from "../components/helpers/media"
import { getFirstActiveOutput, setOutput } from "../components/helpers/output"
import { loadShows } from "../components/helpers/setShow"
import { getLayoutRef } from "../components/helpers/show"
import { updateOut } from "../components/helpers/showActions"
import { _show } from "../components/helpers/shows"
import { API_ACTIONS } from "../components/actions/api"
import { clearAll } from "../components/output/clear"
import { REMOTE } from "./../../types/Channels"
import { actions, actionTags, activePage, activeProject, activeShow, activeTimers, categories, connections, dictionary, folders, language, openedFolders, outLocked, overlayCategories, overlays, playerVideos, projects, remotePassword, runningActions, scriptures, shows, showsCache, styles, templateCategories, templates, timers, variables, variableTags } from "./../stores"
import { lastClickTime } from "./common"
import { translateText } from "./language"
import { requestMainResult, sendMain } from "../IPC/main"
import { RemoteMediaViews } from "./remoteMediaViews"
import { send } from "./request"
import { isRemoteConnectionAuthorized } from "./remoteAccess"
import { sendData, setConnectedState } from "./sendData"

// REMOTE

let currentOut = ""
let loadingShow = ""
const remoteMediaViews = new RemoteMediaViews()

connections.subscribe((current) => {
    remoteMediaViews.closeUnauthorized((connectionId) => !!current.REMOTE?.[connectionId]?.entered, closeRemoteMediaConnection)
})

export const receiveREMOTE: WebHandlerTable<RemoteProtocol> = {
    PASSWORD: (msg) => {
        const id = msg.id || ""
        const info: RemotePasswordInfo = { dictionary: get(dictionary), password: !!get(remotePassword).length }
        if (info.password) return { id: msg.id, channel: "PASSWORD", data: info }

        setConnectedState("REMOTE", id, "entered", true)
        initializeRemote(id)

        return { id, channel: "SHOWS", data: get(shows) }
    },
    ACCESS: (msg) => {
        const id = msg.id || ""
        if (get(remotePassword).length && msg.data !== get(remotePassword)) return { id: msg.id, channel: "ERROR", data: "wrongPass" }

        send(REMOTE, ["LANGUAGE"], { lang: get(language), strings: get(dictionary) })

        setConnectedState("REMOTE", id, "entered", true)
        initializeRemote(id)

        return { id, channel: "SHOWS", data: get(shows) }
    },
    SHOW: async (msg) => {
        const showID = msg.data

        if (msg.id) {
            setConnectedState("REMOTE", msg.id, "active", showID)
        }

        loadingShow = showID
        await loadShows([showID])

        const data: RemoteShow = clone({ ...((await convertBackgrounds(get(showsCache)[showID])) as Show), id: showID })

        if (loadingShow !== showID) return

        openShow(showID)
        return { id: msg.id, channel: "SHOW", data }
    },
    // read-only twin of SHOW: loads and answers the show, but never opens it in the main window (replay after reconnect)
    GET_SHOW: async (msg) => {
        const showID = msg.data

        if (msg.id) setConnectedState("REMOTE", msg.id, "active", showID)

        loadingShow = showID
        await loadShows([showID])

        const data: RemoteShow = clone({ ...((await convertBackgrounds(get(showsCache)[showID])) as Show), id: showID })

        if (loadingShow !== showID) return

        return { id: msg.id, channel: "SHOW", data }
    },
    OUT: async (msg) => {
        if (get(outLocked)) return
        // set id because convertBackgrounds might use a long time
        const currentId = uid(5)
        currentOut = currentId

        const currentOutput = getFirstActiveOutput()
        const out = currentOutput?.out?.slide || null
        const request = msg.data
        let id = ""
        let data: RemoteOutSlide | RemoteOutTemp | undefined

        if (request === "clear") {
            clearAll()
            return
        } else if (request && typeof request === "object") {
            id = request.id
            await loadShows([id])

            const layout = getLayoutRef(id)
            if (request.index < layout.length && request.index >= 0) {
                const layoutId = request.layout || _show(id).get("settings.activeLayout")
                updateOut(id, request.index, _show(id).layouts([layoutId]).ref()[0])
                setOutput("slide", { ...request, layout: layoutId })
            }

            return
        } else if (typeof request === "number" && out) {
            id = out.id

            const layout = getLayoutRef(id)
            if (request < layout.length && request >= 0) {
                const newOutSlide: OutSlide = { ...out, index: request }
                setOutput("slide", newOutSlide)
            }
        } else if (out?.id === "temp") {
            data = out as RemoteOutTemp
        } else {
            const style = currentOutput?.style ? get(styles)[currentOutput.style] : null
            const slideData: RemoteOutSlide = { slide: out ? (out.index ?? null) : null, layout: out?.layout || null, styleRes: style?.aspectRatio || style?.resolution || null }
            // && out.id !== oldOutSlide
            if (out && out.id !== "temp") {
                id = out.id
                oldOutSlide = id
                slideData.show = { ...((await convertBackgrounds(get(showsCache)[id], false, true)) as Show), id }
            }

            if (currentOut !== currentId) return
            data = slideData
        }
        if (id?.length && msg.id) {
            setConnectedState("REMOTE", msg.id, "active", id)
        }

        if (!data) return
        return { id: msg.id, channel: "OUT", data }
    },
    OUT_DATA: (msg) => {
        const currentOutput = getFirstActiveOutput()
        const out: OutData = clone(currentOutput?.out || {})

        // Include player video name for online media (YouTube, Vimeo, etc.)
        if (out.background?.type === "player" && out.background?.id) {
            const playerName = get(playerVideos)[out.background.id]?.name
            if (playerName) out.background.name = playerName
        }

        return { id: msg.id, channel: "OUT_DATA", data: out }
    },
    PROJECTS: (msg) => {
        const data: RemoteProject[] = removeDeleted(keysToID(clone(get(projects))))

        // get names
        data.forEach((project) => {
            project.shows.forEach((show) => {
                if (show.type === "overlay") show.name = get(overlays)[show.id]?.name || translateText("main.unnamed")
            })
        })

        return { id: msg.id, channel: "PROJECTS", data }
    },
    GET_SCRIPTURE: async (msg) => {
        const request = msg.data
        const { id, bookKey, chapterKey, bookIndex, chapterIndex } = request || {}
        if (!id) return

        const jsonBible = await loadJsonBible(id)
        if (!jsonBible) return

        const reply = (extra: Partial<RemoteScriptureResponse>) => ({ id: msg.id, channel: "GET_SCRIPTURE" as const, data: { ...request, ...extra } })

        const scriptureData: any = get(scriptures)[id]
        const isApi = scriptureData?.api === true

        if (!isApi) return reply({ bible: jsonBible.data })

        if (bookKey && !chapterKey) {
            try {
                const bookData = await jsonBible.getBook(bookKey)
                const mapped = (bookData.data.chapters || []).map((c) => ({
                    number: c.number,
                    keyName: c.number
                }))
                return reply({ bibleUpdate: { kind: "chapters", id, bookIndex, chapters: mapped } })
            } catch (error) {
                console.warn(`Failed to load book ${bookKey}:`, error)
                return reply({ bibleUpdate: { kind: "chapters", id, bookIndex, chapters: [] } })
            }
        }

        if (bookKey && chapterKey) {
            try {
                const bookData = await jsonBible.getBook(bookKey)
                const chapterData = await bookData.getChapter(chapterKey)
                const versesData = chapterData.data.verses
                const mappedVerses = versesData.map((v) => ({
                    number: v.number,
                    text: v.text,
                    keyName: v.number
                }))
                return reply({ bibleUpdate: { kind: "verses", id, bookIndex, chapterIndex, verses: mappedVerses } })
            } catch (error) {
                console.warn(`Failed to load ${bookKey} ${chapterKey}:`, error)
                return reply({ bibleUpdate: { kind: "verses", id, bookIndex, chapterIndex, verses: [] } })
            }
        }

        const books = jsonBible.data.books
        const mappedBooks = (books || []).map((b) => ({
            name: b.name,
            number: b.number,
            keyName: b.id,
            chapters: []
        }))
        return reply({ bible: { books: mappedBooks } })
    },
    SEARCH_SCRIPTURE: async (msg) => {
        const request = msg.data
        const { id, searchTerm, searchType, bookFilter } = request || {}
        if (!id || !searchTerm) return

        const jsonBible = await loadJsonBible(id)
        if (!jsonBible) return

        const reply = (searchResults: RemoteScriptureSearchResponse["searchResults"]) => ({ id: msg.id, channel: "SEARCH_SCRIPTURE" as const, data: { ...request, searchResults } })

        const scriptureData: any = get(scriptures)[id]
        const isApi = scriptureData?.api === true

        // For local bibles, return null to use cached search
        if (!isApi) return reply(null)

        try {
            if (searchType === "reference") {
                // Use bookSearch for reference parsing (e.g., "John 3:16")
                const result = jsonBible.bookSearch(searchTerm)
                if (result) {
                    // Get book name if we have book number
                    let bookName: string | null = null
                    if (result.book) {
                        const bookObj = jsonBible.data.books.find((b: any) => b.number === result.book || b.id === result.book)
                        bookName = bookObj?.name || null
                    }
                    return reply({
                        type: "reference",
                        autocompleted: result.autocompleted || undefined,
                        book: result.book || null,
                        bookName: bookName,
                        chapter: result.chapter || null,
                        verses: result.verses || []
                    })
                }
                return reply({ type: "reference", found: false })
            }

            // Use textSearch for content search (minimum 3 characters)
            if (searchTerm.length < 3) return reply({ type: "text", results: [], bookFilter })

            const results = await jsonBible.textSearch(searchTerm)
            let filteredResults = (results || []).map((ref: any) => ({
                book: ref.book,
                chapter: ref.chapter,
                verseNumber: typeof ref.verse === "object" ? ref.verse.number : ref.verse,
                reference: `${ref.book}.${ref.chapter}.${typeof ref.verse === "object" ? ref.verse.number : ref.verse}`,
                referenceFull: ref.reference || "",
                verseText: typeof ref.verse === "object" ? ref.verse.text : ref.text || ""
            }))

            // Apply book filter if provided
            if (bookFilter) {
                filteredResults = filteredResults.filter((ref: any) => ref.book === bookFilter)
            }

            return reply({ type: "text", results: filteredResults.slice(0, 50), bookFilter })
        } catch (err) {
            console.error("Scripture search error:", err)
            return reply({ type: searchType || "", error: true })
        }
    },
    GET_OVERLAYS: (msg) => ({ id: msg.id, channel: "GET_OVERLAYS", data: { overlays: get(overlays), categories: get(overlayCategories) } }),
    GET_TEMPLATES: (msg) => ({ id: msg.id, channel: "GET_TEMPLATES", data: { templates: get(templates), categories: get(templateCategories) } }),
    MEDIA_LIST: async (msg) => {
        const connectionId = msg.id || ""
        const data = msg.data
        if (!connectionId || !data) return
        if (!isRemoteConnectionAuthorized(connectionId)) {
            return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId: data.requestId, code: "unavailable" } }
        }

        let view = remoteMediaViews.get(connectionId)
        if (data.page === 0) {
            closeRemoteMediaConnection(connectionId)
            view = { requestId: data.requestId, path: data.path }
            remoteMediaViews.set(connectionId, view)
        } else if (!view || view.requestId !== data.requestId || view.path !== data.path) {
            return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId: data.requestId, code: "cursor_expired" } }
        }

        if (!view || view.activeRequest) return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId: data.requestId, code: "busy" } }
        const controller = new AbortController()
        view.activeRequest = controller
        const result = await requestMainResult(Main.REMOTE_MEDIA_PAGE, { ...data, connectionId }, { signal: controller.signal })

        if (remoteMediaViews.get(connectionId) !== view || controller.signal.aborted) return
        view.activeRequest = undefined

        if (result.status === "success") return { id: connectionId, channel: "MEDIA_PAGE", data: result.data }
        if (result.status === "cancelled") return
        return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId: data.requestId, code: remoteMediaResultCode(result) } }
    },
    MEDIA_CANCEL: (msg) => {
        const connectionId = msg.id || ""
        const requestId = msg.data?.requestId
        if (connectionId && requestId) closeRemoteMediaConnection(connectionId, requestId)
    },
    MEDIA_THUMBNAIL: async (msg) => {
        const connectionId = msg.id || ""
        const request = msg.data
        if (!request) return
        const result = await requestMainResult(Main.REMOTE_MEDIA_THUMBNAIL, { connectionId, path: request.path })
        if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId)) {
            return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId: request.requestId, code: remoteMediaResultCode(result) } }
        }

        return { id: connectionId, channel: "MEDIA_THUMBNAIL_RESULT", data: { requestId: request.requestId, ...result.data } }
    },
    MEDIA_PLAY: async (msg) => {
        const connectionId = msg.id || ""
        const request = msg.data
        if (!request) return
        const result = await requestMainResult(Main.REMOTE_MEDIA_RESOLVE, { connectionId, path: request.path })
        if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId)) {
            return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId: request.requestId, ok: false, code: remoteMediaResultCode(result) } }
        }
        if (get(outLocked)) return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId: request.requestId, ok: false, code: "unavailable" } }

        if (result.data.kind === "audio") API_ACTIONS.play_audio({ path: result.data.path })
        else {
            const playbackData: { type: string; loop?: boolean; muted?: boolean } = { type: result.data.kind }
            if (typeof request.loop === "boolean") playbackData.loop = request.loop
            if (typeof request.muted === "boolean") playbackData.muted = request.muted
            API_ACTIONS.play_media({ path: result.data.path, data: playbackData })
        }
        return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId: request.requestId, ok: true } }
    },
    GET_FUNCTIONS: (msg) => ({
        id: msg.id,
        channel: "GET_FUNCTIONS",
        data: {
            actions: get(actions),
            actionTags: get(actionTags),
            variables: get(variables),
            variableTags: get(variableTags),
            timers: get(timers),
            activeTimers: get(activeTimers),
            runningActions: get(runningActions)
        }
    })
}

let oldOutSlide = ""

export async function initializeRemote(id: string) {
    // Send access confirmation to remote client
    window.api.send(REMOTE, { id, channel: "ACCESS", data: null })

    // Send initial data to remote client
    sendData(REMOTE, { channel: "PROJECTS", data: removeDeleted(keysToID(get(projects))) })
    send(REMOTE, ["FOLDERS"], { folders: get(folders), opened: get(openedFolders) })
    send(REMOTE, ["PROJECT"], get(activeProject))

    // Get current output state
    const currentOutput = getFirstActiveOutput()
    const styleRes = currentOutput?.style ? get(styles)[currentOutput?.style]?.aspectRatio || get(styles)[currentOutput?.style]?.resolution : null

    const outSlide = currentOutput?.out?.slide
    const out: any = {
        slide: outSlide ? outSlide.index : null,
        layout: outSlide?.layout || null,
        styleRes
    }

    if (out.slide !== null && outSlide?.id && outSlide?.id !== "temp") {
        oldOutSlide = outSlide.id
        // Output & thumbnail
        out.show = await convertBackgrounds(get(showsCache)[oldOutSlide] || {})
        out.show.id = oldOutSlide

        // Send slide thumbnails asynchronously
        setTimeout(async () => {
            window.api.send(REMOTE, await receiveREMOTE.SHOW({ channel: "SHOW", id, data: oldOutSlide }))
        })
    }

    // Send targeted initial state to this connection
    // Use sendData so the proper OUT payload is constructed (handles scripture 'temp' etc.)
    sendData(REMOTE, { id, channel: "OUT" })
    sendData(REMOTE, { id, channel: "OUT_DATA" })

    // Send additional data
    send(REMOTE, ["SCRIPTURE"], get(scriptures))
    send(REMOTE, ["CATEGORIES"], get(categories))
}

export async function convertBackgrounds(show: Show, noLoad = false, init = false) {
    if (!show?.media) return {}

    show = clone(show)
    const mediaIds = new Set<string>()
    show.layouts[show.settings?.activeLayout]?.slides.forEach((a) => {
        if (a.background) mediaIds.add(a.background)
        Object.values(a.children || {}).forEach((child) => {
            if (child?.background) mediaIds.add(child.background)
        })
    })
    ;[...mediaIds].forEach((id) => {
        let path = show.media[id]?.path || show.media[id]?.id || ""
        if (!path) return

        if (noLoad) {
            show.media[id].path = getThumbnailPath(path, mediaSize.slideSize)
            return
        }

        const remoteConnections = Object.keys(get(connections).REMOTE || {})?.length || 0
        if (!init && remoteConnections === 0) return

        // const base64Path: string = await getBase64Path(path, mediaSize.slideSize)
        // keep paths and let remote request them lazily.
        show.media[id].path = path
    })

    return show
}

// const toBase64 = file => new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.readAsDataURL(file);
//     reader.onload = () => resolve(reader.result);
//     reader.onerror = error => reject(error);
// });

function openShow(id: string) {
    if (get(activePage) !== "show") return
    if (!get(shows)[id]) return
    // don't open if last interaction was less than 20 seconds ago
    if (Date.now() - lastClickTime < 20000) return

    activeShow.set({ id })
}

export function closeRemoteMediaConnection(connectionId: string, requestId?: string) {
    remoteMediaViews.close(connectionId, requestId, () => sendMain(Main.REMOTE_MEDIA_CLOSE, { connectionId }))
}

function remoteMediaResultCode(result: { status: string; error?: { message: string } }): RemoteMediaErrorCode {
    const message = result.status === "error" ? result.error?.message || "" : ""
    const codes: RemoteMediaErrorCode[] = ["busy", "invalid_path", "cursor_expired", "restart_required", "not_media", "too_large", "unavailable"]
    return codes.find((code) => message.toLowerCase().includes(code)) || "unavailable"
}
