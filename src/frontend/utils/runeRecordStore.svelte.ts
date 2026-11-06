import { SvelteMap } from "svelte/reactivity"
import type { Readable } from "svelte/store"

/**
 * A record of entries (`{ [id]: T }`) kept in Svelte 5 rune state, behind a small domain interface.
 *
 * - Fine-grained: every entry has its own signal, so `select(id)` / `getEntry(id)` only react to that entry.
 * - Store compatible: `subscribe` / `get` give legacy components (`$store`) and `get()` callers the whole record,
 *   delivered synchronously like a writable store, but only when something actually changed.
 * - Writes are diffed per entry (deep equality): unchanged entries keep their reference and notify nobody.
 *
 * Use `createRuneRecordStore` for any large global record store (outputs, media, shows cache ...) and export the
 * result through a domain module that exposes only the read side plus named write functions.
 */

export type RecordOf<T> = { [id: string]: T }
export type RecordUpdater<T> = (draft: RecordOf<T>) => RecordOf<T> | void

export interface RuneRecordStore<T> extends Readable<RecordOf<T>> {
    /** Current record. Plain object, never reactive, safe to call from `$:`/effects without adding dependencies. */
    get(): RecordOf<T>
    /** Reactive read of one entry (tracks only that entry when called inside `$derived` / `$effect`). */
    getEntry(id: string): T | undefined
    /** Store of a single entry. Runs once with the current value, then only when that entry changes (batched per tick). */
    select(id: string): Readable<T | undefined>
    /** Replace the whole record. Entries equal to the current ones are kept by reference. */
    set(next: RecordOf<T>): void
    /** Legacy-style update: `draft` is a deep copy, mutate it or return a new record. */
    update(updater: RecordUpdater<T>): void
    /** Update one existing entry from a partial or an updater. Unknown ids are ignored. */
    patch(id: string, change: Partial<T> | ((entry: T) => T)): void
    /** Add or replace one entry. */
    put(id: string, entry: T): void
    remove(id: string): void
}

// same behaviour as helpers/array clone, kept local so this module stays free of the app's helper import graph
function copy<T>(value: T): T {
    if (value === null || typeof value !== "object") return value
    try {
        return structuredClone(value)
    } catch {
        try {
            return JSON.parse(JSON.stringify(value))
        } catch {
            return value
        }
    }
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b)
    if (Array.isArray(a) !== Array.isArray(b)) return false

    if (Array.isArray(a)) {
        const other = b as unknown[]
        if (a.length !== other.length) return false
        return a.every((value, index) => isDeepEqual(value, other[index]))
    }

    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && isDeepEqual((a as any)[key], (b as any)[key]))
}

export function createRuneRecordStore<T>(initial: RecordOf<T> = {}): RuneRecordStore<T> {
    // reactive side: one signal per entry. Only ever read through getEntry/select.
    const entries = new SvelteMap<string, T>()
    // plain side: the record handed to store subscribers and get(). Rebuilt (new identity) on every real change.
    let record: RecordOf<T> = {}
    const subscribers = new Set<(value: RecordOf<T>) => void>()

    function commit(next: RecordOf<T>) {
        const nextIds = Object.keys(next)
        const currentIds = Object.keys(record)
        let changed = false

        const merged: RecordOf<T> = {}
        for (const id of nextIds) {
            const previous = record[id]
            if (id in record && isDeepEqual(previous, next[id])) {
                merged[id] = previous
                continue
            }
            merged[id] = next[id]
            entries.set(id, next[id])
            changed = true
        }

        const removed = currentIds.filter((id) => !(id in merged))
        for (const id of removed) {
            entries.delete(id)
            changed = true
        }

        // key order is meaningful (first entry = default). Rebuild the signal map if the order moved.
        const sameOrder = nextIds.length === currentIds.length - removed.length && nextIds.every((id, index) => id === currentIds.filter((key) => key in merged)[index])
        if (!sameOrder) {
            entries.clear()
            for (const id of nextIds) entries.set(id, merged[id])
            changed = true
        }

        if (!changed) return
        record = merged
        for (const run of [...subscribers]) run(record)
    }

    commit(initial)

    const store: RuneRecordStore<T> = {
        subscribe(run) {
            subscribers.add(run)
            run(record)
            return () => {
                subscribers.delete(run)
            }
        },

        get: () => record,

        getEntry: (id) => entries.get(id),

        select(id) {
            return {
                subscribe(run) {
                    let last: T | undefined = record[id]
                    run(last)
                    // the effect's first run happens after subscribe returns; comparing with `last` keeps a write that lands
                    // in between from being swallowed, and drops runs where the value did not change
                    return $effect.root(() => {
                        $effect(() => {
                            const value = entries.get(id)
                            if (value === last) return
                            last = value
                            run(value)
                        })
                    })
                }
            }
        },

        set: (next) => commit(next),

        update(updater) {
            const draft = copy(record)
            const result = updater(draft)
            commit(result ?? draft)
        },

        patch(id, change) {
            const current = record[id]
            if (current === undefined) return
            const next = typeof change === "function" ? change(current) : { ...current, ...change }
            commit({ ...record, [id]: next })
        },

        put: (id, entry) => commit({ ...record, [id]: entry }),

        remove(id) {
            if (!(id in record)) return
            const next = { ...record }
            delete next[id]
            commit(next)
        }
    }

    return store
}
