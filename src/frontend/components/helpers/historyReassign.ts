// Pure reassign helper for the history system.
// Given a store object `keyData`, an update `newValue`, and a set of selectors,
// returns a NEW store object in which every touched path (top-level, [id], [id][key],
// [id][key][subkey], array entries) is a fresh reference. This guarantees that downstream
// reactive subscribers using reference equality (e.g. Svelte <svelte:options immutable />)
// see the change.
//
// Mirrors the branches of the legacy in-place updateKeyData() in historyActions.ts, with
// one extension: when no `key` is provided, the entire [id] entry is replaced with newValue.

export interface ReassignParams {
    id: string
    key?: string
    subkey?: string
    index?: number
    indexes?: number[]
    keys?: string[]
}

export function applyReassignUpdate<T extends Record<string, any>>(keyData: T, newValue: any, params: ReassignParams): T {
    const { id, key, subkey, index, indexes, keys } = params

    // Top-level entry replace (no `key`): replace the whole [id] entry.
    if (!key && !keys?.length) {
        if (keyData[id] === undefined) return keyData
        return { ...keyData, [id]: newValue }
    }

    // From here on we need an existing entry.
    if (!keyData[id]) return keyData

    // Branch 1: indexes — replace specific positions in an array under `key`.
    if (key && indexes?.length && Array.isArray(keyData[id][key])) {
        const currentArr = keyData[id][key] as any[]

        // If current array is empty and newValue is a non-empty array, replace wholesale.
        if (!currentArr.length && Array.isArray(newValue) && newValue.length) {
            return {
                ...keyData,
                [id]: { ...keyData[id], [key]: [...newValue] }
            }
        }

        let mapped = currentArr.map((value, i) => {
            if (!indexes.includes(i)) return value
            const currentIndex = indexes.findIndex((a) => a === i)
            const replacerValue = Array.isArray(newValue) ? newValue[currentIndex] : newValue

            if (subkey) {
                // Spread the entry to get a fresh ref for the modified position.
                return { ...value, [subkey]: replacerValue }
            }
            return replacerValue
        })

        mapped = mapped.filter((a) => a !== undefined)

        return {
            ...keyData,
            [id]: { ...keyData[id], [key]: mapped }
        }
    }

    // Branch 2: keys — multi top-level-key update (nested under `key`).
    if (key && keys?.length) {
        // We need to build a new keyData[id][key] with updated entries for each currentKey.
        const entry = keyData[id]
        const parent = entry[key] ? { ...entry[key] } : {}

        // `newValue` may itself be an array we treat as "dataIsArray".
        const dataIsArray = (keyData as any).dataIsArray

        keys.forEach((currentKey) => {
            let replacerValue = typeof newValue === "string" || newValue?.[currentKey] === undefined || dataIsArray ? newValue : newValue[currentKey]
            if (index === -1 && !Array.isArray(replacerValue)) replacerValue = [replacerValue]

            if (subkey) {
                if (!parent[currentKey]) return
                const child = { ...parent[currentKey] }
                if (index === -1) {
                    child[subkey] = [...(child[subkey] || []), ...replacerValue]
                } else {
                    child[subkey] = replacerValue
                }
                parent[currentKey] = child
                return
            }

            if (index === -1) {
                parent[currentKey] = [...(parent[currentKey] || []), ...replacerValue]
            } else {
                parent[currentKey] = replacerValue
            }
        })

        return {
            ...keyData,
            [id]: { ...entry, [key]: parent }
        }
    }

    // Branch 3: subkey — nested object update under `key.subkey`.
    if (key && subkey) {
        const entry = keyData[id]
        const existingKey = entry[key] ? { ...entry[key] } : {}

        // Array splice insert under subkey.
        if (index !== undefined && Array.isArray(existingKey[subkey])) {
            const arr = [...existingKey[subkey]]
            if (index === -1) arr.push(newValue)
            else arr.splice(index, 0, newValue)
            existingKey[subkey] = arr
        } else {
            existingKey[subkey] = newValue
        }

        return {
            ...keyData,
            [id]: { ...entry, [key]: existingKey }
        }
    }

    // Branch 4: index splice into an array under `key`.
    if (key && index !== undefined && Array.isArray(keyData[id][key])) {
        const arr = [...(keyData[id][key] as any[])]
        if (index === -1) arr.push(newValue)
        else arr.splice(index, 0, newValue)

        return {
            ...keyData,
            [id]: { ...keyData[id], [key]: arr }
        }
    }

    // Branch 5: plain key replace.
    if (key) {
        return {
            ...keyData,
            [id]: { ...keyData[id], [key]: newValue }
        }
    }

    return keyData
}
