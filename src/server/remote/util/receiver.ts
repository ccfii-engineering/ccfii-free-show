import { sanitizeVerseText } from "../../../common/scripture/sanitizeVerseText"
import type { RemoteOutTemp, RemoteResponses } from "../../../types/remote/protocol"
import type { WebReceiverTable } from "../../../types/WebProtocol"
import type { Item, Show } from "../../../types/Show"
import { setError, translate } from "./helpers"
import { markReady, send } from "./socket"
import { _, _get, _set, _update, activeTimers, currentScriptureState, overlays, runningActions, scriptureCache, scriptures, timers } from "./stores"

function sanitizeBiblePayload(bible: any) {
    if (!bible || !Array.isArray(bible.books)) return bible

    const books = bible.books.map((book: any) => ({
        ...book,
        chapters: Array.isArray(book.chapters)
            ? book.chapters.map((chapter: any) => ({
                  ...chapter,
                  verses: sanitizeChapterVerses(chapter.verses)
              }))
            : book.chapters
    }))

    return { ...bible, books }
}

function sanitizeChapterVerses(verses: any) {
    if (!Array.isArray(verses)) return verses

    return verses.map((verse: any, index: number) => {
        const sanitizedVerse = { ...verse }
        sanitizedVerse.number = sanitizedVerse.number || index + 1
        sanitizedVerse.text = sanitizeVerseText(sanitizedVerse.text || sanitizedVerse.value || "")
        return sanitizedVerse
    })
}

export type ReceiverKey = keyof RemoteResponses
export const receiver: WebReceiverTable<RemoteResponses> = {
    PASSWORD: (data) => {
        if (data.dictionary) _set("dictionary", data.dictionary)
        let password: boolean = data.password
        _update("password", "required", password)
    },
    ERROR: (data) => {
        if (data === "wrongPass") {
            setError(translate("remote.wrong_password"))
            localStorage.removeItem("password")
            _update("password", "required", true)
        } else setError(data)
    },
    LANGUAGE: (data) => {
        _.dictionary.update((a) => {
            Object.keys(a).forEach((i) => {
                Object.keys(a[i] || {}).forEach((j) => {
                    if (data.strings[i]?.[j] && a[i]) a[i]![j] = data.strings[i]![j]
                })
            })
            return a
        })
    },
    ACCESS: () => {
        const storedPwd = _get("password").stored
        if (storedPwd && storedPwd.length) localStorage.password = storedPwd
        _set("isConnected", true)

        // Request current output data which should include scripture state
        send("API:get_output")

        // re-issue show/output/function requests that were dropped or answered before a reconnect
        markReady()
    },

    /////

    SHOWS: (data) => {
        const shows = Object.keys(data).map((id) => ({ id, ...data[id] }))
        _set("shows", shows)
        if (_get("quickPlay")) _set("activeTab", "shows")
    },
    // "SHOWS_CACHE": (data: any) => {
    //   showsCache = data
    //   },
    SHOW: (data) => {
        if (!_get("isConnected")) return

        if (!_get("activeShow") && !_get("quickPlay")) _set("activeTab", "show")
        // if (activeTab === "shows" || activeTab === "project" || activeTab === "projects") activeTab = "show"
        // shows[data.id] = data
        // activeShow = data.id

        _set("activeShow", data)
    },
    OUT: (data) => {
        if (!_get("isConnected")) return

        // scripture
        if (isOutTemp(data)) {
            _set("outSlide", 0)
            _set("outLayout", "default")
            const show = getShowFromItems(data.tempItems || [], data.nextSlides?.[0])
            _set("outShow", show)

            _update("isCleared", "all", false)
            _update("isCleared", "slide", false)
            return
        }

        // clear
        if (data.slide === undefined) return

        _set("outSlide", data.slide)
        if (data.layout) _set("outLayout", data.layout)
        // if (data.styleRes) _set("styleRes", data.styleRes)
        if (_get("outSlide") === null) _set("outShow", null)
        else if (data.show) {
            _set("outShow", data.show)
            if (!_get("activeShow")) _set("activeTab", "slide")
            if (!_get("activeShow")) _set("activeShow", _get("outShow"))
        } else if (_get("outShow") === null && _get("activeShow")) {
            _set("outShow", _get("activeShow"))
        }
    },
    OUT_DATA: (data) => {
        _set("outData", data)
        send("API:get_cleared")
    },
    FOLDERS: (data) => {
        if (!_get("isConnected")) return

        _set("folders", data.folders)
        if (!_get("openedFolders").length) _set("openedFolders", data.opened)
        // console.log(folders)
    },
    PROJECTS: (data) => {
        if (!_get("isConnected")) return

        // Sort once before setting to avoid double store update
        const sortedProjects = [...data].sort((a: any, b: any) => b.created - a.created)
        _set("projects", sortedProjects)

        const project = sortedProjects.find((a: any) => a.id === _get("project"))
        if (project) _set("activeProject", project)
    },
    PROJECT: (data) => {
        if (!_get("project") && data && _get("isConnected")) {
            _set("project", data)

            const project = _get("projects").find((a: any) => a.id === data)
            if (project) _set("activeProject", project)

            if (!_get("activeShow") && !_get("quickPlay")) _set("activeTab", "project")
        }
    },
    SCRIPTURE: (data) => {
        scriptures.set(data)
    },
    CATEGORIES: (data) => {
        _.categories.set(data)
    },
    ACTIVE_SCRIPTURE: (data) => {
        const source: any = data?.api || data?.bible || data || {}
        const scriptureId: string = String(source.scriptureId || source.id || "")

        type NormalizedScriptureState = {
            scriptureId: string
            bookId: number
            chapterId: number
            activeVerses: number[]
        }

        const normalized: NormalizedScriptureState = {
            scriptureId,
            // Treat numeric bookId as zero-based if provided and valid, else -1
            bookId: Number.isInteger(source.bookId) && source.bookId >= 0 ? (source.bookId as number) : -1,
            // Normalize chapterId consistently to zero-based when provided as a string like "book.chapter"
            // If numeric and integer, assume it is already zero-based (upstream contract)
            chapterId: (() => {
                const chapter = source.chapterId
                if (Number.isInteger(chapter)) return chapter as number
                if (typeof chapter === "string") {
                    const parts = chapter.split(".")
                    const num = parseInt(parts[1] ?? parts[0], 10)
                    return Number.isFinite(num) ? num - 1 : -1
                }
                return -1
            })(),
            // Sanitize, dedupe and sort verses to make "latest" deterministic
            activeVerses: (() => {
                const raw = Array.isArray(source.activeVerses) ? source.activeVerses : []
                const nums: number[] = raw.map((v: any) => parseInt(v, 10)).filter((n: number): n is number => Number.isFinite(n) && n > 0)
                return Array.from(new Set<number>(nums)).sort((a: number, b: number) => a - b)
            })()
        }

        currentScriptureState.set(normalized)
    },
    GET_SCRIPTURE: (data) => {
        if (!data) return

        if (data.bible) {
            _update("scriptureCache", data.id, sanitizeBiblePayload(data.bible))
            return
        }

        const update = data.bibleUpdate
        if (!update) return

        if (update.kind === "chapters") {
            const { id, bookIndex, chapters } = update
            if (!id || typeof bookIndex !== "number" || !Array.isArray(chapters)) return

            scriptureCache.update((cache) => {
                const bible = cache[id] || { books: [] as any[] }
                const books = Array.isArray(bible.books) ? bible.books : []
                const book = books[bookIndex] || {}
                book.chapters = (chapters || []).map((c: any) => ({
                    number: c.number,
                    keyName: c.keyName,
                    verses: []
                }))
                books[bookIndex] = book
                cache[id] = { ...bible, books }
                return cache
            })
            return
        }

        if (update.kind === "verses") {
            const { id, bookIndex, chapterIndex, verses } = update
            if (!id || typeof bookIndex !== "number" || typeof chapterIndex !== "number" || !Array.isArray(verses)) return

            scriptureCache.update((cache) => {
                const bible = cache[id] || { books: [] as any[] }
                const books = Array.isArray(bible.books) ? bible.books : []
                const book = books[bookIndex] || { chapters: [] as any[] }
                const chaptersArr = Array.isArray(book.chapters) ? book.chapters : []
                const chapter = chaptersArr[chapterIndex] || { verses: [] }
                chapter.verses = (verses || []).map((v: any, i: number) => ({
                    number: v.number || i + 1,
                    text: sanitizeVerseText(v.text || v.value || "")
                }))
                chaptersArr[chapterIndex] = chapter
                book.chapters = chaptersArr
                books[bookIndex] = book
                cache[id] = { ...bible, books }
                return cache
            })
        }
    },
    // SCRIPTURE_CHAPTERS and SCRIPTURE_VERSES are handled by GET_SCRIPTURE's bibleUpdate handling
    SEARCH_SCRIPTURE: (data) => {
        // Store search results for the search component to use
        if (data.searchResults !== undefined) {
            _set("scriptureSearchResults", data.searchResults)
        }
    },
    OVERLAYS: (data) => {
        overlays.set(data)
    },
    OVERLAY_CATEGORIES: (data) => {
        _set("overlayCategories", data)
    },
    TEMPLATES: (data) => {
        _set("templates", data)
    },
    TEMPLATE_CATEGORIES: (data) => {
        _set("templateCategories", data)
    },
    OUTPUT_STYLE_TEMPLATE: (data) => {
        _set("outputStyleTemplate", data || null)
    },
    ACTIONS: (data) => {
        _set("actions", data)
    },
    ACTION_TAGS: (data) => {
        _set("actionTags", data)
    },
    VARIABLES: (data) => {
        _set("variables", data)
    },
    VARIABLE_TAGS: (data) => {
        _set("variableTags", data)
    },
    TIMER_TAGS: (data) => {
        _set("timerTags", data)
    },
    TIMERS: (data) => {
        timers.set(data)
    },
    ACTIVE_TIMERS: (data) => {
        activeTimers.set(data)
    },
    RUNNING_ACTIONS: (data) => {
        runningActions.set(data)
    },

    GET_OVERLAYS: (data) => {
        overlays.set(data.overlays)
        _set("overlayCategories", data.categories)
    },
    GET_TEMPLATES: (data) => {
        _set("templates", data.templates)
        _set("templateCategories", data.categories)
        _set("outputStyleTemplate", data.outputStyleTemplate || null)
    },
    GET_FUNCTIONS: (data) => {
        _set("actions", data.actions)
        _set("actionTags", data.actionTags)
        _set("variables", data.variables)
        _set("variableTags", data.variableTags)
        _set("timerTags", data.timerTags || {})
        timers.set(data.timers)
        activeTimers.set(data.activeTimers)
        runningActions.set(data.runningActions)
    },
    GET_AUDIO: (data) => {
        _set("audio", data)
    },
    MEDIA: (data) => {
        if (!data) {
            _set("audio", {})
            return
        }

        const audioFiles: any = {}

        // Handle if data is an object of media items
        if (typeof data === "object" && !Array.isArray(data)) {
            Object.keys(data).forEach((id) => {
                const item = data[id]
                // Check various ways audio might be identified
                if (item && (item.type === "audio" || item.audioPath || item.path?.match(/\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i))) {
                    audioFiles[id] = {
                        id,
                        name: item.name || item.path?.split(/[\/\\]/).pop() || id,
                        path: item.path || item.audioPath || id,
                        ...item
                    }
                }
            })
        }

        _set("audio", audioFiles)
    },

    /////

    "API:get_thumbnail": (data) => {
        if (!data.path || !data.thumbnail) return

        _update("mediaCache", data.path, data.thumbnail)
    },
    "API:get_plain_text": (data) => {
        _update("textCache", data.id, data.value)
    },
    "API:get_groups": (data) => {
        _update("groupsCache", data.id, data.value)
    },
    "API:get_cleared": (data) => {
        _set("isCleared", data)
    },

    "API:get_playing_audio_data": (data) => {
        _set("playingAudioData", data)
    },
    "API:get_playing_audio_time": (data) => {
        _set("playingAudioTime", data)
    },
    "API:get_playing_video_time": (data) => {
        _set("playingVideoTime", data || 0)
    },
    "API:get_playing_video_duration": (data) => {
        _set("playingVideoDuration", data || 0)
    },
    "API:get_playing_video_state": (data) => {
        if (!data) return
        if (data.duration !== undefined) _set("playingVideoDuration", data.duration || 0)
        if (data.time !== undefined) _set("playingVideoTime", data.time || 0)
        if (data.paused !== undefined) _set("playingVideoPaused", !!data.paused)
        if (data.loop !== undefined) _set("playingVideoLoop", !!data.loop)
        if (data.muted !== undefined) _set("playingVideoMuted", data.muted !== false)
    },

    "API:get_media_loop_state": (data) => {
        _set("playingVideoLoop", data !== false)
    },

    "API:toggle_media_loop": () => {
        // Refresh state after toggle
        send("API:get_playing_video_state")
    },

    "API:get_pdf_thumbnails": (data) => {
        _update("pdfPages", data.path, data.pages)
    },

    "API:create_show": (data) => {
        send("SHOW", data.id)
        _set("active", { id: data.id, type: "show" })
        _set("activeTab", "show")
    }
}

function isOutTemp(data: RemoteResponses["OUT"]): data is RemoteOutTemp {
    return "id" in data && data.id === "temp"
}

function getShowFromItems(items: Item[], nextSlideItems: Item[] | undefined) {
    const show: Show = {
        name: "",
        settings: {
            activeLayout: "default",
            template: null
        },
        category: null,
        timestamps: { created: 0, modified: null, used: null },
        meta: {},
        media: {},
        slides: {
            one: {
                group: "",
                color: "",
                settings: {},
                notes: "",
                items: items
            }
        },
        layouts: { default: { name: "", notes: "", slides: [{ id: "one" }] } }
    }

    if (nextSlideItems) {
        show.slides.two = {
            group: "",
            color: "",
            settings: {},
            notes: "",
            items: nextSlideItems
        }
        show.layouts.default.slides.push({ id: "two" })
    }

    return show
}
