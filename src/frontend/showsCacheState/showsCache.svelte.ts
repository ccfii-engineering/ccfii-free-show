import type { Readable, Writable } from "svelte/store"
import type { Show, Shows } from "../../types/Show"
import { createRuneRecordStore } from "../utils/runeRecordStore.svelte"
import type { RecordUpdater } from "../utils/runeRecordStore.svelte"

/**
 * Shows cache domain module (loaded shows keyed by show id). The single owner of shows-cache state.
 *
 * Reads:
 *  - `$showsCache` / `get(showsCache)` / `showsCache.subscribe`: the whole record, store compatible (legacy components).
 *  - `getCachedShow(id)`: plain read of one show.
 *  - `selectCachedShow(id)`: store of one show, runs only when that show changes.
 *  - `cachedShowById(id)`: reactive read for runes code ($derived / $effect), tracks only that show.
 *
 * Writes (the only way to change the cache):
 *  - `setShowsCache(record)`, `updateShowsCache(draft => ...)`, `patchCachedShow(id, partial | fn)`, `putCachedShow`, `removeCachedShow`.
 *  `updateShowsCache` copies a show only when the updater reads it (a typical edit touches one show out of the cache).
 *  Writes are diffed per show: unchanged shows keep their reference and wake nobody.
 */

const state = createRuneRecordStore<Show>({}, { lazyDraft: true })

/** Read-only store of all cached shows. */
export const showsCache: Readable<Shows> = { subscribe: state.subscribe }

export const getShowsCache = (): Shows => state.get()
export const getCachedShow = (id: string): Show | undefined => state.get()[id]
export const cachedShowById = (id: string): Show | undefined => state.getEntry(id)
export const selectCachedShow = (id: string): Readable<Show | undefined> => state.select(id)

export const setShowsCache = (next: Shows): void => state.set(next)
export const updateShowsCache = (updater: RecordUpdater<Show>): void => state.update(updater)
export const patchCachedShow = (id: string, change: Partial<Show> | ((current: Show) => Show)): void => state.patch(id, change)
export const putCachedShow = (id: string, show: Show): void => state.put(id, show)
export const removeCachedShow = (id: string): void => state.remove(id)

/**
 * Writable face for the generic `$` store map (settings load/history address stores by key and call `.set`/`.update`).
 * Delegates to this module; do not import it anywhere else.
 */
export const writableShowsCache: Writable<Shows> = {
    subscribe: state.subscribe,
    set: setShowsCache,
    update: (updater) => updateShowsCache((draft) => updater(draft))
}
