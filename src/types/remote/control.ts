import type { LayoutRef, OutSlide, Show, Slide } from "../Show"

export type RemoteMediaKind = "folder" | "image" | "video" | "audio"
export type RemoteMediaErrorCode = "busy" | "invalid_path" | "cursor_expired" | "restart_required" | "not_media" | "too_large" | "unavailable"

export interface RemoteMediaItem {
    path: string
    name: string
    kind: RemoteMediaKind
    size: number
    modifiedAt: number
}

export interface RemoteMediaPageRequest {
    requestId: string
    path: string
    page: number
    cursor?: string
}

export interface RemoteMediaPageIPCRequest extends RemoteMediaPageRequest {
    connectionId: string
}

export interface RemoteMediaPage {
    requestId: string
    path: string
    parentPath: string
    page: number
    items: RemoteMediaItem[]
    nextCursor: string | null
    hasMore: boolean
}

export interface RemoteMediaPathRequest {
    path: string
    kind?: Exclude<RemoteMediaKind, "folder">
}

export interface RemoteMediaPathIPCRequest extends RemoteMediaPathRequest {
    connectionId: string
}

export interface RemoteMediaResolvedPath {
    path: string
    kind: Exclude<RemoteMediaKind, "folder">
    size: number
    modifiedAt: number
}

export interface RemoteMediaThumbnailRequest {
    path: string
}

export interface RemoteMediaThumbnailIPCRequest extends RemoteMediaThumbnailRequest {
    connectionId: string
}

export interface RemoteMediaThumbnail {
    path: string
    thumbnail: string
}

export interface RemoteMediaCloseRequest {
    connectionId: string
}

export type ControllerPresenterStatus = "slide" | "temp" | "cleared" | "empty"

export interface ControllerPresenterPreview {
    showId?: string
    showName?: string
    layoutId?: string
    index: number
    slide: Slide
    layoutSlide: LayoutRef | { id: ""; data: Record<string, never> }
    media: Show["media"]
    assets: Record<string, string>
    playback?: ControllerPresenterPlayback
}

export interface ControllerPresenterPlayback extends Pick<OutSlide, "line" | "revealCount" | "itemClickReveal"> {
    styleLines: number
}

export interface ControllerPresenterSnapshot {
    revision: number
    outputId: string
    status: ControllerPresenterStatus
    showId?: string
    showName?: string
    layoutId?: string
    current: ControllerPresenterPreview | null
    next: ControllerPresenterPreview | null
    notes: string
    atEnd: boolean
}

export type ControllerPresenterRequest = Record<string, never>

export interface ControllerPresenterThumbnailRequest {
    revision: number
    assetId: string
}

export interface ControllerPresenterThumbnailIPCRequest extends ControllerPresenterThumbnailRequest {
    connectionId: string
    path: string
}

export interface ControllerPresenterThumbnailResult extends ControllerPresenterThumbnailRequest {
    thumbnail: string
}
