import type { MediaStyle } from "../../../../types/Main"
import type { Styles } from "../../../../types/Settings"
import type { OutBackground } from "../../../../types/Show"

export type GPUBackgroundData = OutBackground & MediaStyle

/** Resolve the same inherited media defaults used by the DOM renderer before GPU delegation. */
export function resolveGPUBackgroundStyle(data: GPUBackgroundData, currentStyle: Partial<Styles> | null = null): GPUBackgroundData {
    const defaults: MediaStyle = {
        filter: "",
        flipped: false,
        flippedY: false,
        blend: "",
        fit: currentStyle?.fit || "contain",
        fitOptions: {
            blurAmount: currentStyle?.blurAmount ?? 6,
            blurOpacity: currentStyle?.blurOpacity || 0.3
        },
        volume: currentStyle?.volume ?? 100,
        speed: "1",
        fromTime: 0,
        toTime: 0,
        softLoop: 0,
        videoType: "",
        cropping: currentStyle?.cropping || {},
        style: ""
    }

    return { ...defaults, ...data }
}
