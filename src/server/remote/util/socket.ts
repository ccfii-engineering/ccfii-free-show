import { io } from "socket.io-client"
import { _get, _set, _update } from "./stores"
import { receiver, ReceiverKey } from "./receiver"

const socket = io()
let id: string = ""
const responseListeners = new Map<string, Set<(data: any) => void>>()

export function initSocket() {
    socket.on("connect", () => {
        id = socket.id || ""
        console.log("Connected with id:", id)

        // try accessing with saved password
        const SAVED_PASSWORD = localStorage.password
        if (SAVED_PASSWORD) {
            _update("password", "remember", true)
            _update("password", "stored", SAVED_PASSWORD)
            send("ACCESS", SAVED_PASSWORD)
            return
        }

        // check if there is a password!
        send("PASSWORD")
    })

    socket.on("REMOTE", (msg) => {
        let key = msg.channel as ReceiverKey
        if (!_get("isConnected")) {
            const UNCONNECTED_ALLOWED_KEYS = ["PASSWORD", "ERROR", "ACCESS", "LANGUAGE"]
            if (!UNCONNECTED_ALLOWED_KEYS.includes(key)) return
        }

        const listeners = responseListeners.get(key)
        if (listeners) {
            listeners.forEach((listener) => listener(msg.data))
            return
        }

        if (!receiver[key]) {
            if (msg.data !== null) console.log("Unhandled message:", msg)
            return
        }

        receiver[key](msg.data)
    })

    socket.on("disconnect", () => _set("isConnected", false))
}

export function onResponse(channel: string, listener: (data: any) => void) {
    let listeners = responseListeners.get(channel)
    if (!listeners) {
        listeners = new Set()
        responseListeners.set(channel, listeners)
    }
    listeners.add(listener)

    return () => {
        listeners?.delete(listener)
        if (!listeners?.size) responseListeners.delete(channel)
    }
}

export const send = (channel: string, data: any = null) => socket.emit("REMOTE", { id, channel, data })
