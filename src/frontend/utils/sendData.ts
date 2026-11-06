import { get } from "svelte/store"
import { CONTROLLER, REMOTE, STAGE } from "../../types/Channels"
import { Main } from "../../types/IPC/Main"
import type { ClientMessage, Clients } from "../../types/Socket"
import { isControllerRequestKey } from "../../types/controller/protocol"
import { isStageRequestKey } from "../../types/stage/protocol"
import { isRemoteRequestKey, REMOTE_MEDIA_REQUEST_KEYS, REMOTE_PRE_AUTH_KEYS } from "../../types/remote/protocol"
import { API_ACTIONS } from "../components/actions/api"
import { checkWindowCapture } from "../components/helpers/output"
import { connections, outLocked, remotePassword, shows } from "../stores"
import { requestMainResult } from "../IPC/main"
import { isMainWindow } from "./common"
import { receiveCONTROLLER } from "./controllerTalk"
import { isRemoteConnectionAuthorized } from "./remoteAccess"
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
        if (!isRemoteRequestKey(channel) || !receiveREMOTE[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        // the wire message is untyped; each handler narrows it to its protocol request
        msg = (await (receiveREMOTE[channel] as (request: ClientMessage) => Promise<ClientMessage | void>)(msg)) as ClientMessage
    } else if (id === STAGE) {
        if (!isStageRequestKey(channel) || !receiveSTAGE[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        // the wire message is untyped; each handler narrows it to its protocol request. It answers the connection
        // that asked (or the first one for app-internal requests); the reply keeps the original id and listenerId.
        const reply = await (receiveSTAGE[channel] as (request: ClientMessage) => ClientMessage | void | Promise<ClientMessage | void>)({ ...msg, id: connectionId })
        msg = (reply ? { ...msg, channel: reply.channel, data: reply.data ?? null } : undefined) as ClientMessage
    } else if (id === CONTROLLER) {
        if (!isControllerRequestKey(channel) || !receiveCONTROLLER[channel]) return console.info("UNKNOWN CHANNEL:", channel)
        msg = (await (receiveCONTROLLER[channel] as (request: ClientMessage) => Promise<ClientMessage | void>)(msg)) as ClientMessage
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

function requiresRemoteEntry(channel: string, apiId: string | undefined) {
    if (REMOTE_MEDIA_REQUEST_KEYS.includes(channel)) return true
    return channel === "API" && ["get_thumbnail", "play_media", "play_audio", "set_template", "set_plain_text"].includes(apiId || "")
}

function isPreAuthRemoteChannel(channel: string) {
    return REMOTE_PRE_AUTH_KEYS.includes(channel)
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
