export function updateMappedEntries<M extends Record<string, any>>(map: M, ids: Iterable<string>, updater: (entry: M[string], id: string) => M[string]): M {
    let next = map

    for (const id of ids) {
        if (!(id in map)) continue

        const current = map[id]
        const updated = updater(current, id)
        if (updated === current) continue

        if (next === map) next = { ...map }
        next[id] = updated
    }

    return next
}
