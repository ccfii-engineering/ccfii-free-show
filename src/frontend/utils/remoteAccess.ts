import { get } from "svelte/store"
import { connections, remotePassword } from "../stores"

/** A Remote connection may act only after it has entered (password accepted, or none required). */
export function isRemoteConnectionAuthorized(connectionId: string | undefined): boolean {
    if (!connectionId) return false
    const connection = get(connections).REMOTE?.[connectionId]
    return !!connection?.entered && (!get(remotePassword).length || connection.entered === true)
}
