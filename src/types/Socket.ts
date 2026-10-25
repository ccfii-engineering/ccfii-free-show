export interface Message {
    channel: string
    data?: any
    id?: string

    name?: string
    path?: string
}

export type Clients = "REMOTE" | "STAGE" | "CONTROLLER" | "OUTPUT_STREAM"
export interface ClientMessage {
    channel: ClientChannels
    id?: DeviceID
    api?: string // API ACTION ID (channel: "API:id")
    data?: any
    send?: boolean
}

type DeviceID = string
type ClientChannels = "API" | "CONNECTION" | "DISCONNECT" | "ERROR" | "DATA" | "PASSWORD" | "ACCESS" | "SWITCH" | "SHOWS" | "LAYOUT" | "SHOWS_CACHE" | "SHOW" | "SHOW_DATA" | "PROJECTS" | "OUT" | "OUT_DATA" | "BACKGROUND" | "MEDIA_LIST" | "MEDIA_CANCEL" | "MEDIA_THUMBNAIL" | "MEDIA_PLAY" | "MEDIA_PAGE" | "MEDIA_THUMBNAIL_RESULT" | "MEDIA_PLAY_RESULT" | "MEDIA_ERROR" | "PRESENTER_SUBSCRIBE" | "PRESENTER_UNSUBSCRIBE" | "PRESENTER_STATE" | "PRESENTER_THUMBNAIL" | "PRESENTER_THUMBNAIL_RESULT"

export interface ServerData {
    outputId?: string
    sendAudio?: boolean
}
