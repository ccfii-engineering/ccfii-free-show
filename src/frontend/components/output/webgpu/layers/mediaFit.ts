interface FitTarget {
    texture?: { width: number; height: number }
    width: number
    height: number
    x: number
    y: number
}

export function applyFit(sprite: FitTarget, parentWidth: number, parentHeight: number, fit: string, sourceWidth?: number, sourceHeight?: number): void {
    if (!sprite.texture) return

    const textureWidth = sourceWidth || sprite.texture.width
    const textureHeight = sourceHeight || sprite.texture.height
    if (textureWidth === 0 || textureHeight === 0) return

    const scaleX = parentWidth / textureWidth
    const scaleY = parentHeight / textureHeight

    switch (fit) {
        case "fill":
            sprite.width = parentWidth
            sprite.height = parentHeight
            sprite.x = 0
            sprite.y = 0
            break
        case "cover": {
            const scale = Math.max(scaleX, scaleY)
            sprite.width = textureWidth * scale
            sprite.height = textureHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
        case "contain":
        default: {
            const scale = Math.min(scaleX, scaleY)
            sprite.width = textureWidth * scale
            sprite.height = textureHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
    }
}
