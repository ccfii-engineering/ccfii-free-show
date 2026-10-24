export interface MediaLoopBackground {
    id?: string
    path?: string
    loop?: boolean
    [key: string]: any
}

interface MediaLoopCommandOptions {
    outputId: string
    background: MediaLoopBackground
    setBackground: (background: MediaLoopBackground) => void
    setOutputLoop: (path: string, outputId: string, loop: boolean) => void
}

export function toggleMediaLoop({ outputId, background, setBackground, setOutputLoop }: MediaLoopCommandOptions): boolean {
    const loop = !isLooping(background)
    const path = background.path || background.id || ""

    setBackground({ ...background, loop })

    if (path) setOutputLoop(path, outputId, loop)

    return loop
}

export function getOutputMediaLoop(background: MediaLoopBackground | null | undefined): boolean {
    return isLooping(background)
}

function isLooping(background: MediaLoopBackground | null | undefined): boolean {
    return background?.loop === true
}
