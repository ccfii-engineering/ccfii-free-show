import { Assets, Sprite, Texture, type Container } from "pixi.js"
import type { MediaStyle } from "../../../../../types/Main"

export interface MediaSpriteConfig {
    path: string
    type: "image" | "video"
    mediaStyle: MediaStyle
    loop: boolean
    muted: boolean
    startAt: number
}

const textureCache = new Map<string, Texture>()

function toFileUrl(path: string): string {
    if (!path || path.startsWith("http") || path.startsWith("file://") || path.startsWith("blob:") || path.startsWith("data:")) return path
    if (path.startsWith("/")) return `file://${path}`
    return path
}

export async function loadImageTexture(path: string): Promise<Texture> {
    const cached = textureCache.get(path)
    if (cached && !cached.destroyed) return cached

    try {
        const fileUrl = toFileUrl(path)
        console.log("MediaLayer: loading image:", fileUrl)
        const texture = await Assets.load(fileUrl)
        textureCache.set(path, texture)
        return texture
    } catch (e) {
        console.warn("MediaLayer: failed to load image:", path, e)
        return Texture.EMPTY
    }
}

export function createVideoTexture(videoElement: HTMLVideoElement): Texture {
    return Texture.from(videoElement)
}

export function createMediaSprite(texture: Texture, container: Container, parentWidth: number, parentHeight: number, fit: string = "contain"): Sprite {
    const sprite = new Sprite(texture)
    applyFit(sprite, parentWidth, parentHeight, fit)
    container.addChild(sprite)
    return sprite
}

export function applyFit(sprite: Sprite, parentWidth: number, parentHeight: number, fit: string): void {
    if (!sprite.texture || sprite.texture === Texture.EMPTY) return

    const texWidth = sprite.texture.width
    const texHeight = sprite.texture.height
    if (texWidth === 0 || texHeight === 0) return

    const scaleX = parentWidth / texWidth
    const scaleY = parentHeight / texHeight

    switch (fit) {
        case "cover":
        case "fill": {
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
    for (const [, texture] of textureCache) {
        if (!texture.destroyed) texture.destroy(true)
    }
    textureCache.clear()
}
