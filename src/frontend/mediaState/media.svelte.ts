import type { Readable, Writable } from "svelte/store"
import type { Media, MediaStyle } from "../../types/Main"
import { createRuneRecordStore } from "../utils/runeRecordStore.svelte"
import type { RecordUpdater } from "../utils/runeRecordStore.svelte"

/**
 * Media domain module (per-file display settings keyed by path). The single owner of media state.
 *
 * Reads:
 *  - `$media` / `get(media)` / `media.subscribe`: the whole record, store compatible (legacy components).
 *  - `getMediaEntry(path)`: plain read of one entry.
 *  - `selectMediaEntry(path)`: store of one entry, runs only when that entry changes.
 *  - `mediaByPath(path)`: reactive read for runes code ($derived / $effect), tracks only that entry.
 *
 * Writes (the only way to change media):
 *  - `setMedia(record)`, `updateMedia(draft => ...)`, `patchMedia(path, partial | fn)`, `putMedia`, `removeMedia`.
 *  `updateMedia` copies an entry only when the updater reads it. Writes are diffed per entry: unchanged entries keep
 *  their reference and wake nobody.
 */

const state = createRuneRecordStore<MediaStyle>({}, { lazyDraft: true })

/** Read-only store of all media settings. */
export const media: Readable<Media> = { subscribe: state.subscribe }

export const getMedia = (): Media => state.get()
export const getMediaEntry = (path: string): MediaStyle | undefined => state.get()[path]
export const mediaByPath = (path: string): MediaStyle | undefined => state.getEntry(path)
export const selectMediaEntry = (path: string): Readable<MediaStyle | undefined> => state.select(path)

export const setMedia = (next: Media): void => state.set(next)
export const updateMedia = (updater: RecordUpdater<MediaStyle>): void => state.update(updater)
export const patchMedia = (path: string, change: Partial<MediaStyle> | ((current: MediaStyle) => MediaStyle)): void => state.patch(path, change)
export const putMedia = (path: string, style: MediaStyle): void => state.put(path, style)
export const removeMedia = (path: string): void => state.remove(path)

/**
 * Writable face for the generic `$` store map (settings load/history address stores by key and call `.set`/`.update`).
 * Delegates to this module; do not import it anywhere else.
 */
export const writableMedia: Writable<Media> = {
    subscribe: state.subscribe,
    set: setMedia,
    update: (updater) => updateMedia((draft) => updater(draft))
}
