// Per-entry derived stores.
//
// Problem: The hot global stores ($media, $outputs, $showsCache, $styles, $templates) are
// subscribed by hundreds of reactive sites. Every .update() on one of these wakes EVERY
// subscriber, which then re-runs its reactive blocks — even though most subscribers only
// care about ONE entry in the map. This is the "reactive storm" described in
// docs/superpowers/audits/2026-04-09-performance-audit.md.
//
// Fix: Expose per-key derived stores. A derived store built via this module:
//   1. Is cached per (store, key) — repeat calls return the same Readable.
//   2. Only emits when the entry at that key has actually changed (deep-equal via JSON gate).
//   3. Lets subscribers subscribe to a single entry, so unrelated mutations never wake them.
//
// Usage in a .svelte component:
//   import { mediaEntry } from "../utils/perEntryStores"
//   $: entry = mediaEntry(path)
//   $: mediaStyle = getMediaStyle($entry, currentStyle)

import { readable, type Readable } from "svelte/store"
import type { Output } from "../../types/Output"
import { selectOutput } from "../outputState/outputs.svelte"
import { selectMediaEntry } from "../mediaState/media.svelte"
import { selectCachedShow } from "../showsCacheState/showsCache.svelte"
import { styles, templates } from "../stores"
import { createEntryAccessor, createRefEntryAccessor } from "./perEntryStoresFactory"

export { createEntryAccessor, createRefEntryAccessor } from "./perEntryStoresFactory"

// ============================================================================
// Concrete accessors bound to the app's hot stores.
//
// Element types are inferred from each store's index-signature — no manual widening.
// ============================================================================

// Outputs, media and the shows cache are backed by rune record stores (outputState/, mediaState/, showsCacheState/):
// each entry has its own listener set, so these readables wake only for that entry, with no per-write JSON gate.
// Missing/empty ids emit null like the other accessors.
function createSelectAccessor<T>(select: (id: string) => Readable<T | undefined>): (id: string) => Readable<T> {
    const none: Readable<T> = readable(null as unknown as T)
    const cache = new Map<string, Readable<T>>()
    return (id) => {
        if (!id) return none
        let entry = cache.get(id)
        if (!entry) {
            const source = select(id)
            entry = { subscribe: (run) => source.subscribe((value) => run((value ?? null) as unknown as T)) }
            cache.set(id, entry)
        }
        return entry
    }
}

/** Subscribe to a single entry in $media by path. */
export const mediaEntry = createSelectAccessor(selectMediaEntry)

/** Subscribe to a single entry in $outputs by output id. */
export const outputEntry = createSelectAccessor<Output>(selectOutput)

/** Subscribe to a single entry in $showsCache by show id. */
export const showEntry = createSelectAccessor(selectCachedShow)

/** Subscribe to a single entry in $styles by style id. */
export const styleEntry = createEntryAccessor(styles)

/** Subscribe to a single style entry using reference changes only. */
export const styleEntryRef = createRefEntryAccessor(styles)

/** Subscribe to a single entry in $templates by template id. */
export const templateEntry = createEntryAccessor(templates)
