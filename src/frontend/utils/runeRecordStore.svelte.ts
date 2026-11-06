import { SvelteMap } from "svelte/reactivity"
import type { Readable } from "svelte/store"

/**
 * A record of entries (`{ [id]: T }`) kept in Svelte 5 rune state, behind a small domain interface.
 *
 * - Fine-grained: `select(id)` wakes only the subscribers of entries that changed; `getEntry(id)` is backed by one rune signal
 *   per entry, so `$derived` / `$effect` code tracks only the entries it reads.
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
    /** Store of a single entry. Runs synchronously with the current value, then only when that entry changes. Emits undefined when missing. */
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

export interface RuneRecordStoreOptions {
    /**
     * `update()` hands the updater a copy-on-read draft instead of a deep copy of the whole record: an entry is copied the
     * first time the updater reads it. Use for records with many or large entries (shows cache, media).
     */
    lazyDraft?: boolean
}

/** Draft record that deep-copies an entry on first read. `commit` receives the materialised record. */
function createLazyDraft<T>(record: RecordOf<T>): { draft: RecordOf<T>; materialised: RecordOf<T> } {
    const materialised: RecordOf<T> = { ...record }
    const copied = new Set<string>()
    const draft = new Proxy(materialised, {
        get(target, key, receiver) {
            if (typeof key === "string" && !copied.has(key) && Object.prototype.hasOwnProperty.call(target, key)) {
                copied.add(key)
                target[key] = copy(target[key])
            }
            return Reflect.get(target, key, receiver)
        },
        set(target, key, value) {
            if (typeof key === "string") copied.add(key)
            return Reflect.set(target, key, value)
        },
        deleteProperty(target, key) {
            if (typeof key === "string") copied.delete(key)
            return Reflect.deleteProperty(target, key)
        }
    })
    return { draft, materialised }
}

export function createRuneRecordStore<T>(initial: RecordOf<T> = {}, options: RuneRecordStoreOptions = {}): RuneRecordStore<T> {
    // reactive side: one signal per entry. Only ever read through getEntry/select.
    const entries = new SvelteMap<string, T>()
    // plain side: the record handed to store subscribers and get(). Rebuilt (new identity) on every real change.
    let record: RecordOf<T> = {}
    const subscribers = new Set<(value: RecordOf<T>) => void>()
    // per-entry listeners behind select(id): called synchronously, only for the entries that changed
    const entrySubscribers = new Map<string, Set<(value: T | undefined) => void>>()

    function commit(next: RecordOf<T>) {
        const nextIds = Object.keys(next)
        const currentIds = Object.keys(record)
        let changed = false
        const changedIds: string[] = []

        const merged: RecordOf<T> = {}
        for (const id of nextIds) {
            const previous = record[id]
            if (id in record && isDeepEqual(previous, next[id])) {
                merged[id] = previous
                continue
            }
            merged[id] = next[id]
            entries.set(id, next[id])
            changedIds.push(id)
            changed = true
        }

        const removed = currentIds.filter((id) => !(id in merged))
        for (const id of removed) {
            entries.delete(id)
            changedIds.push(id)
            changed = true
        }

        // key order is meaningful (first entry = default). Existing keys keep their relative order and new keys are appended,
        // anything else means the order moved and the signal map is rebuilt.
        const kept = currentIds.filter((id) => id in merged)
        const expectedOrder = [...kept, ...nextIds.filter((id) => !(id in record))]
        if (!expectedOrder.every((id, index) => id === nextIds[index])) {
            entries.clear()
            for (const id of nextIds) entries.set(id, merged[id])
            changed = true
        }

        if (!changed) return
        record = merged
        for (const run of [...subscribers]) run(record)
        for (const id of changedIds) for (const run of [...(entrySubscribers.get(id) ?? [])]) run(record[id])
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
                    let listeners = entrySubscribers.get(id)
                    if (!listeners) entrySubscribers.set(id, (listeners = new Set()))
                    listeners.add(run)
                    run(record[id])
                    return () => {
                        listeners.delete(run)
                        if (!listeners.size) entrySubscribers.delete(id)
                    }
                }
            }
        },

        set: (next) => commit(next),

        update(updater) {
            if (options.lazyDraft) {
                const { draft, materialised } = createLazyDraft(record)
                const result = updater(draft)
                commit(result === undefined || result === draft ? materialised : result)
                return
            }
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
