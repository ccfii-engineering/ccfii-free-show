// Pure, store-agnostic factory for per-entry derived stores.
//
// Kept in a separate file from perEntryStores.ts so unit tests can import the factory
// without transitively pulling in ../stores (which imports the whole app-wide store
// graph, which node:test can't resolve without explicit file extensions).

import { derived, type Readable, type Writable } from "svelte/store"

/**
 * Build a per-key accessor for a given Writable map store.
 * Returns a function `(key) => Readable<T>` where T is the element type of the map.
 *
 * The returned readable only emits when the entry's JSON-serialized shape changes. This
 * handles both reassignment AND in-place mutations of the parent map — the JSON gate is
 * the tradeoff that keeps the helper safe with the mixed-pattern codebase.
 *
 * Type note: the readable's inner type is `T` (the element type), not `T | null`. At
 * runtime we DO emit `null` when the key is missing — but the typed interface matches
 * TypeScript's index-signature access semantics (`map[key]` returns `T` without a
 * `| undefined` union when `noUncheckedIndexedAccess` is off). This preserves parity with
 * the pre-migration pattern `$store[key] || defaultValue` that the rest of the codebase
 * relies on.
 */
export function createEntryAccessor<M extends { [k: string]: any }>(store: Writable<M>): (key: string) => Readable<M[string]> {
    type T = M[string]
    const cache = new Map<string, Readable<T>>()
    let emptySentinel: Readable<T> | undefined

    return function entryAccessor(key: string): Readable<T> {
        if (!key) {
            if (!emptySentinel) emptySentinel = derived(store, () => null as unknown as T)
            return emptySentinel
        }

        let entry = cache.get(key)
        if (entry) return entry

        // JSON-gate dedup. Reference equality can't be trusted as a fast path because the
        // codebase still has in-place mutation sites that change inner values without
        // changing the top-level ref — we have to stringify every update to stay correct.
        let lastJson: string | undefined = undefined
        entry = derived(store, ($s, set) => {
            const current = ($s && ($s as M)[key]) || null
            const json = JSON.stringify(current)
            if (json !== lastJson) {
                lastJson = json
                set(current as unknown as T)
            }
        })
        cache.set(key, entry)
        return entry
    }
}
