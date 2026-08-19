import { AlphaFilter, BlurFilter, ColorMatrixFilter, Sprite, Texture, type Container, type Filter } from "pixi.js"
import type { MediaStyle } from "../../../../../types/Main"
import { ReferenceCache } from "../../gpu/ReferenceCache"
import { cancelAnimation } from "../backgroundAnimation"
import { applyFit } from "./mediaFit"
import { parseCSSMediaFilters } from "./mediaFilters"

export { applyFit } from "./mediaFit"

export interface MediaSpriteConfig {
    path: string
    type: "image" | "video"
    mediaStyle: MediaStyle
    loop: boolean
    muted: boolean
    startAt: number
}

export interface LoadedTexture {
    texture: Texture
    width: number
    height: number
}

const textureCache = new ReferenceCache<LoadedTexture>((entry) => {
    if (entry.texture !== Texture.EMPTY && !entry.texture.destroyed) entry.texture.destroy(true)
})
const ownedFilters = new WeakMap<Sprite, Filter[]>()

function toFileUrl(path: string): string {
    if (!path || path.startsWith("http") || path.startsWith("file://") || path.startsWith("blob:") || path.startsWith("data:")) return path
    if (path.startsWith("/")) return `file://${path}`
    return path
}

export async function loadImageTexture(path: string): Promise<LoadedTexture> {
    return textureCache.acquire(path, async () => {
        try {
            const fileUrl = toFileUrl(path)
            // Use Image element instead of Assets.load for file:// compatibility in Electron
            const img = new Image()
            img.crossOrigin = "anonymous"
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = (e) => reject(e)
                img.src = fileUrl
            })
            const texture = Texture.from(img)
            return { texture, width: img.naturalWidth, height: img.naturalHeight }
        } catch (e) {
            console.warn("MediaLayer: failed to load image:", path, e)
            return { texture: Texture.EMPTY, width: 0, height: 0 }
        }
    })
}

export function releaseImageTexture(path: string): void {
    if (path) textureCache.release(path)
}

export function createVideoTexture(videoElement: HTMLVideoElement): Texture {
    return Texture.from(videoElement)
}

export function createMediaSprite(texture: Texture, container: Container, parentWidth: number, parentHeight: number, fit = "contain", sourceWidth?: number, sourceHeight?: number): Sprite {
    const sprite = new Sprite(texture)
    applyFit(sprite, parentWidth, parentHeight, fit, sourceWidth, sourceHeight)
    container.addChild(sprite)
    return sprite
}

export function applyMediaStyle(sprite: Sprite, mediaStyle: MediaStyle): void {
    sprite.scale.x = Math.abs(sprite.scale.x) * (mediaStyle.flipped ? -1 : 1)
    sprite.scale.y = Math.abs(sprite.scale.y) * (mediaStyle.flippedY ? -1 : 1)
    if (mediaStyle.flipped) sprite.x += sprite.width
    if (mediaStyle.flippedY) sprite.y += sprite.height
    sprite.blendMode = (mediaStyle.blend || "normal") as any
    applyMediaFilters(sprite, mediaStyle.filter)
}

function applyMediaFilters(sprite: Sprite, filterValue: string | undefined): void {
    for (const filter of ownedFilters.get(sprite) || []) filter.destroy()

    const filters: Filter[] = []
    let colorMatrix: ColorMatrixFilter | null = null
    const matrix = () => {
        if (!colorMatrix) colorMatrix = new ColorMatrixFilter()
        return colorMatrix
    }

    for (const operation of parseCSSMediaFilters(filterValue)) {
        switch (operation.name) {
            case "brightness":
                matrix().brightness(operation.value, true)
                break
            case "contrast":
                matrix().contrast(operation.value, true)
                break
            case "saturate":
                matrix().saturate(operation.value, true)
                break
            case "grayscale":
                matrix().greyscale(operation.value, true)
                break
            case "hue-rotate":
                matrix().hue(operation.value, true)
                break
            case "sepia":
                if (operation.value > 0) matrix().sepia(true)
                break
            case "invert":
                if (operation.value > 0) matrix().negative(true)
                break
            case "blur":
                if (operation.value > 0) filters.push(new BlurFilter({ strength: operation.value }))
                break
            case "opacity":
                filters.push(new AlphaFilter({ alpha: Math.max(0, Math.min(1, operation.value)) }))
                break
        }
    }

    if (colorMatrix) filters.unshift(colorMatrix)
    sprite.filters = filters
    ownedFilters.set(sprite, filters)
}

export function removeSprite(sprite: Sprite | null, container: Container, destroyTexture = false): void {
    if (!sprite) return
    cancelAnimation(sprite)
    for (const filter of ownedFilters.get(sprite) || []) filter.destroy()
    ownedFilters.delete(sprite)
    sprite.filters = []
    container.removeChild(sprite)
    sprite.destroy(destroyTexture ? { texture: true, textureSource: true } : undefined)
}

export function clearTextureCache(): void {
    textureCache.clear()
}

export function getTextureCacheStats(): { entries: number; references: number } {
    return textureCache.snapshot()
}
