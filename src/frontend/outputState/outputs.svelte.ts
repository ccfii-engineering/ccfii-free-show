import type { Readable, Writable } from "svelte/store"
import type { Output, Outputs } from "../../types/Output"
import { createRuneRecordStore } from "../utils/runeRecordStore.svelte"
import type { RecordUpdater } from "../utils/runeRecordStore.svelte"

/**
 * Outputs domain module. The single owner of outputs state.
 *
 * Reads:
 *  - `$outputs` / `get(outputs)` / `outputs.subscribe`: the whole record, store compatible (legacy components).
 *  - `getOutput(id)`: plain read of one output.
 *  - `selectOutput(id)`: store of one output, runs only when that output changes (batched per tick).
 *  - `outputById(id)`: reactive read for runes code ($derived / $effect), tracks only that output.
 *
 * Writes (the only way to change outputs):
 *  - `setOutputs(record)`, `updateOutputs(draft => ...)`, `patchOutput(id, partial | fn)`, `putOutput`, `removeOutput`.
 *  Writes are diffed per output: unchanged outputs keep their reference and wake nobody.
 *
 * Pattern for other large stores: see utils/runeRecordStore.svelte.ts (docs in .scratch / modernize notes #75).
 */

const state = createRuneRecordStore<Output>({})

/** Read-only store of all outputs. */
export const outputs: Readable<Outputs> = { subscribe: state.subscribe }

export const getOutputs = (): Outputs => state.get()
export const getOutput = (id: string): Output | undefined => state.get()[id]
export const outputById = (id: string): Output | undefined => state.getEntry(id)
export const selectOutput = (id: string): Readable<Output | undefined> => state.select(id)

export const setOutputs = (next: Outputs): void => state.set(next)
export const updateOutputs = (updater: RecordUpdater<Output>): void => state.update(updater)
export const patchOutput = (id: string, change: Partial<Output> | ((current: Output) => Output)): void => state.patch(id, change)
export const putOutput = (id: string, output: Output): void => state.put(id, output)
export const removeOutput = (id: string): void => state.remove(id)

/**
 * Writable face for the generic `$` store map (settings load/history address stores by key and call `.set`/`.update`).
 * Delegates to this module; do not import it anywhere else.
 */
export const writableOutputs: Writable<Outputs> = {
    subscribe: state.subscribe,
    set: setOutputs,
    update: (updater) => updateOutputs((draft) => updater(draft))
}
