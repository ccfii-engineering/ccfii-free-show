import type { RuneRecordStore } from "./runeRecordStore.svelte"

// Test helper (needs the rune compiler, so it lives in a .svelte.ts file): records what an $effect that reads one entry sees.
export function trackEntry<T>(store: RuneRecordStore<T>, id: string): (T | undefined)[] {
    const seen: (T | undefined)[] = []
    $effect.root(() => {
        $effect(() => {
            seen.push(store.getEntry(id))
        })
    })
    return seen
}
