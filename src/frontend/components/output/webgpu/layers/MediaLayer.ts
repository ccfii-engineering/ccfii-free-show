import { Sprite, Texture, type Container } from "pixi.js"
import type { MediaStyle } from "../../../../../types/Main"

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

const textureCache = new Map<string, LoadedTexture>()

function toFileUrl(path: string): string {
    if (!path || path.startsWith("http") || path.startsWith("file://") || path.startsWith("blob:") || path.startsWith("data:")) return path
    if (path.startsWith("/")) return `file://${path}`
    return path
}

export async function loadImageTexture(path: string): Promise<LoadedTexture> {
    const cached = textureCache.get(path)
    if (cached && !cached.texture.destroyed) return cached

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
        const result: LoadedTexture = { texture, width: img.naturalWidth, height: img.naturalHeight }
        textureCache.set(path, result)
        return result
    } catch (e) {
        console.warn("MediaLayer: failed to load image:", path, e)
        return { texture: Texture.EMPTY, width: 0, height: 0 }
    }
}

export function createVideoTexture(videoElement: HTMLVideoElement): Texture {
    return Texture.from(videoElement)
}

export function createMediaSprite(texture: Texture, container: Container, parentWidth: number, parentHeight: number, fit: string = "contain", sourceWidth?: number, sourceHeight?: number): Sprite {
    const sprite = new Sprite(texture)
    applyFit(sprite, parentWidth, parentHeight, fit, sourceWidth, sourceHeight)
    container.addChild(sprite)
    return sprite
}

export function applyFit(sprite: Sprite, parentWidth: number, parentHeight: number, fit: string, sourceWidth?: number, sourceHeight?: number): void {
    if (!sprite.texture || sprite.texture === Texture.EMPTY) return

    const texWidth = sourceWidth || sprite.texture.width
    const texHeight = sourceHeight || sprite.texture.height
    if (texWidth === 0 || texHeight === 0) return

    const scaleX = parentWidth / texWidth
    const scaleY = parentHeight / texHeight

    switch (fit) {
        case "fill": {
            sprite.width = parentWidth
            sprite.height = parentHeight
            sprite.x = 0
            sprite.y = 0
            break
        }
        case "cover": {
            const scale = Math.max(scaleX, scaleY)
            sprite.width = texWidth * scale
            sprite.height = texHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
        case "contain":
        default: {
            const scale = Math.min(scaleX, scaleY)
            sprite.width = texWidth * scale
            sprite.height = texHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
    }
}

export function applyMediaStyle(sprite: Sprite, mediaStyle: MediaStyle): void {
    if (mediaStyle.flipped) {
        sprite.scale.x *= -1
        sprite.x += sprite.width
    }
    if (mediaStyle.flippedY) {
        sprite.scale.y *= -1
        sprite.y += sprite.height
    }
}

export function removeSprite(sprite: Sprite | null, container: Container): void {
    if (!sprite) return
    container.removeChild(sprite)
    sprite.destroy()
}

export function clearTextureCache(): void {
    for (const [, entry] of textureCache) {
        if (!entry.texture.destroyed) entry.texture.destroy(true)
    }
    textureCache.clear()
}
