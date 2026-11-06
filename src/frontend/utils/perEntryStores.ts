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
import { media, showsCache, styles, templates } from "../stores"
import { createEntryAccessor, createRefEntryAccessor } from "./perEntryStoresFactory"

export { createEntryAccessor, createRefEntryAccessor } from "./perEntryStoresFactory"

// ============================================================================
// Concrete accessors bound to the app's hot stores.
//
// Element types are inferred from each store's index-signature — no manual widening.
// ============================================================================

/** Subscribe to a single entry in $media by path. */
export const mediaEntry = createEntryAccessor(media)

// Outputs are backed by the rune record store (outputState/outputs.svelte.ts): each output has its own signal,
// so these readables wake only for that output, with no per-write JSON gate. Missing/empty ids emit null like
// the other accessors.
const noOutput: Readable<Output> = readable(null as unknown as Output)
const outputReadables = new Map<string, Readable<Output>>()
function outputEntryReadable(id: string): Readable<Output> {
    if (!id) return noOutput
    let entry = outputReadables.get(id)
    if (!entry) {
        const source = selectOutput(id)
        entry = { subscribe: (run) => source.subscribe((output) => run((output ?? null) as unknown as Output)) }
        outputReadables.set(id, entry)
    }
    return entry
}

/** Subscribe to a single entry in $outputs by output id. */
export const outputEntry = outputEntryReadable

/** Subscribe to a single output entry using reference changes only (same readable: entries are replaced, never mutated). */
export const outputEntryRef = outputEntryReadable

/** Subscribe to a single entry in $showsCache by show id. */
export const showEntry = createEntryAccessor(showsCache)

/** Subscribe to a single entry in $styles by style id. */
export const styleEntry = createEntryAccessor(styles)

/** Subscribe to a single style entry using reference changes only. */
export const styleEntryRef = createRefEntryAccessor(styles)

/** Subscribe to a single entry in $templates by template id. */
export const templateEntry = createEntryAccessor(templates)
