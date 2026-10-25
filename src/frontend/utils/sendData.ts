import { get } from "svelte/store"
import { CONTROLLER, REMOTE, STAGE } from "../../types/Channels"
import { Main } from "../../types/IPC/Main"
import type { ClientMessage, Clients } from "../../types/Socket"
import { API_ACTIONS } from "../components/actions/api"
import { checkWindowCapture } from "../components/helpers/output"
import { connections, outLocked, remotePassword, shows } from "../stores"
import { requestMainResult } from "../IPC/main"
import { isMainWindow } from "./common"
import { receiveCONTROLLER } from "./controllerTalk"
import { closeRemoteMediaConnection, receiveREMOTE } from "./remoteTalk"
import { receiveSTAGE } from "./stageTalk"

export function filterObjectArray(object: any, keys: string[], filter: null | string = null) {
    return (
        Object.entries(object)
            // sometimes object value can be undefined
            .filter(([_id, a]: any) => a)
            .map(([id, a]: any) => ({ id, ...keys.reduce((o, key) => ({ ...o, [key]: a[key] }), {}) }))
            .filter((a: any) => (filter ? a[filter] : true))
    )
}
export function arrayToObject(array: any[], key = "id") {
    return array.reduce((o, a) => ({ ...o, [a[key]]: a }), {})
}

// FUNCTIONS

// get data from client
export function client(id: Clients, msg: ClientMessage) {
    const msgId = msg.id || ""
    if (msg.channel === "CONNECTION") {
        connections.update((c: any) => {
            if (!c[id]) c[id] = {}
            c[id][msgId] = { entered: false, ...msg.data }
            return c
        })
        console.info("SERVER: " + msgId + " connected")

        if (id === "STAGE") checkWindowCapture()
    } else if (msg.channel === "DISCONNECT") {
        connections.update((c: any) => {
            if (c[id]) delete c[id][msgId]
            return c
        })
        if (id === REMOTE) closeRemoteMediaConnection(msgId)
        console.info("SERVER: " + msgId + " disconnected")

        // stop output capture when the last mirror viewer disconnects
        if (id === "STAGE") checkWindowCapture()
    } else sendData(id, msg)
}

export function setConnectedState(type: string, connectionId: string, key = "active", value: string | boolean) {
    connections.update((a) => {
        if (!a[type]) a[type] = {}
        if (!a[type][connectionId]) a[type][connectionId] = {}
        a[type][connectionId][key] = value
        return a
    })
}

// send data to client
export async function sendData(id: Clients, msg: ClientMessage, check = false) {
    // console.log(id, msg)
    if (!isMainWindow()) return

    let channel = msg.channel
    if (channel.includes("API:")) {
        msg.api = channel.split(":")[1]
        channel = "API"
    }

    let connectionId = msg.id
    if (!connectionId) connectionId = Object.keys(get(connections)[id] || {})[0]

    if (id === REMOTE && requiresRemoteEntry(channel, msg.api) && !isRemoteConnectionAuthorized(connectionId)) return

    // when a REMOTE password is set, only honor control/API messages from connections that have authenticated
    if (id === REMOTE && get(remotePassword).length) {
        const PRE_AUTH_CHANNELS = ["PASSWORD", "ACCESS"]
        if (!PRE_AUTH_CHANNELS.includes(channel)) {
            const entered = get(connections).REMOTE?.[connectionId || ""]?.entered
            if (!entered) return
        }
    }

    if (channel === "API") {
        if (!msg.data) msg.data = {}
        const apiId = msg.api || ""
        let data
        if (id === REMOTE && apiId === "get_thumbnail") {
            const result = await requestMainResult(Main.REMOTE_MEDIA_THUMBNAIL, { connectionId: connectionId || "", path: msg.data.path })
            if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId)) return
            data = result.data.thumbnail
        } else if (id === REMOTE && (apiId === "play_media" || apiId === "play_audio")) {
            const result = await requestMainResult(Main.REMOTE_MEDIA_RESOLVE, {
                connectionId: connectionId || "",
                path: msg.data.path,
                ...(apiId === "play_audio" ? { kind: "audio" as const } : {})
            })
            if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId) || get(outLocked)) return
            if (apiId === "play_media" && result.data.kind === "audio") return
            data = await API_ACTIONS[apiId]?.({ ...msg.data, path: result.data.path })
        } else data = await API_ACTIONS[apiId]?.(msg.data)

        if (apiId === "get_thumbnail") msg.data.thumbnail = data
        else msg.data = data

        if (id === "REMOTE" && apiId === "create_show") {
            // update remote shows data, so the new show is properly added
            setTimeout(() => window.api.send(id, { channel: "SHOWS", data: get(shows) }))
        }

        msg.send = true
        if (data === undefined) msg.data = null
    } else if (id === REMOTE) {
        if (!receiveREMOTE[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        msg = await receiveREMOTE[channel](msg)
        if ((msg as any)?._remoteMediaOperation === "thumbnail") msg = (await fetchRemoteMediaThumbnail(msg, connectionId || "")) as any
        else if ((msg as any)?._remoteMediaOperation === "play") msg = (await playRemoteMedia(msg, connectionId || "")) as any
    } else if (id === STAGE) {
        if (!receiveSTAGE[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        msg.data = receiveSTAGE[channel](msg.data, connectionId)

        if (msg.data === undefined) msg.data = null
        if (msg.data?.channel === "ERROR") msg = { ...msg, channel: "ERROR", data: msg.data?.data }
    } else if (id === CONTROLLER) {
        if (!receiveCONTROLLER[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        msg = await receiveCONTROLLER[channel](msg)
    }

    if (id === REMOTE && msg && !isPreAuthRemoteChannel(msg.channel) && !isRemoteConnectionAuthorized(msg.id || connectionId)) return
    if (id === CONTROLLER && msg?.id && !get(connections).CONTROLLER?.[msg.id]) return
    // let ids: string[] = []
    // if (msg.id) ids = [msg.id]
    // else ids = Object.keys(get(connections).REMOTE || {})
    if (msg && (msg.data !== null || msg.send) && (!check || !checkSent(id, msg))) {
        window.api.send(id, msg)
        // ids.forEach((id) => {
        // window.api.send(id, { id, ...msg })
        // })
    }
}

async function fetchRemoteMediaThumbnail(msg: any, connectionId: string) {
    const requestId = msg.data?.requestId
    const result = await requestMainResult(Main.REMOTE_MEDIA_THUMBNAIL, { connectionId, path: msg.data?.path })
    if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId)) {
        return { id: connectionId, channel: "MEDIA_ERROR", data: { requestId, code: mediaIPCErrorCode(result) } }
    }

    return { id: connectionId, channel: "MEDIA_THUMBNAIL_RESULT", data: { requestId, ...result.data } }
}

async function playRemoteMedia(msg: any, connectionId: string) {
    const requestId = msg.data?.requestId
    const result = await requestMainResult(Main.REMOTE_MEDIA_RESOLVE, { connectionId, path: msg.data?.path })
    if (result.status !== "success" || !isRemoteConnectionAuthorized(connectionId)) {
        return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId, ok: false, code: mediaIPCErrorCode(result) } }
    }
    if (get(outLocked)) return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId, ok: false, code: "unavailable" } }

    const action = result.data.kind === "audio" ? API_ACTIONS.play_audio : API_ACTIONS.play_media
    await action({ path: result.data.path })
    return { id: connectionId, channel: "MEDIA_PLAY_RESULT", data: { requestId, ok: true } }
}

function isRemoteConnectionAuthorized(connectionId: string | undefined): boolean {
    if (!connectionId) return false
    const connection = get(connections).REMOTE?.[connectionId]
    return !!connection?.entered && (!get(remotePassword).length || connection.entered === true)
}

function requiresRemoteEntry(channel: string, apiId: string | undefined) {
    if (channel === "MEDIA_LIST" || channel === "MEDIA_CANCEL" || channel === "MEDIA_THUMBNAIL" || channel === "MEDIA_PLAY") return true
    return channel === "API" && ["get_thumbnail", "play_media", "play_audio"].includes(apiId || "")
}

function isPreAuthRemoteChannel(channel: string) {
    return ["PASSWORD", "ACCESS", "ERROR", "LANGUAGE"].includes(channel)
}

function mediaIPCErrorCode(result: any) {
    if (result.status === "error") {
        const message = result.error.message.toLowerCase()
        for (const code of ["busy", "invalid_path", "cursor_expired", "restart_required", "not_media", "too_large", "unavailable"]) {
            if (message.includes(code)) return code
        }
    }
    return "unavailable"
}

// limit data sent per second
const timeouts: any = {}
const time = 1000
export function timedout(id: Clients, msg: ClientMessage, run: () => void) {
    const timeID = id + (msg.id || "") + msg.channel
    if (!timeouts[timeID]) {
        timeouts[timeID] = true
        const first: string = JSON.stringify(msg.data)
        run()
        // TODO: msg does not change!!!
        setTimeout(() => {
            if (JSON.stringify(msg.data) !== first) run()
            delete timeouts[timeID]
        }, time)
    }
}

// check previous
const sent: any = { REMOTE: {}, STAGE: {} }
function checkSent(id: Clients, msg: any): boolean {
    const serialized = JSON.stringify(msg.data)
    if (sent[id][msg.channel] !== serialized) {
        sent[id][msg.channel] = serialized
        return false
    }
    return true
}

// send data per connection to all
export function eachConnection(id: Clients, channel: any, callback: any) {
    Object.entries(get(connections)[id] || {}).forEach(async ([clientID, value]: any) => {
        const data = await callback(value)
        if (data) window.api.send(id, { id: clientID, channel, data })
    })
}
