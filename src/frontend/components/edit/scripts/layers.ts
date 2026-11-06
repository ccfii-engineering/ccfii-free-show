import type { Item } from "../../../../types/Show"

export interface Layer {
    item: Item
    /** index in the stored item array (back to front) */
    index: number
    /** true when the item was added by a template (Item.fromTemplate) */
    fromTemplate: boolean
}

/** Layers listed front to back: the top of the list is the front-most item (the last stored item). */
export function getLayersFrontToBack(items: Item[] | null | undefined): Layer[] {
    if (!Array.isArray(items)) return []
    const layers: Layer[] = []
    for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index]
        layers.push({ item, index, fromTemplate: !!item?.fromTemplate })
    }
    return layers
}
