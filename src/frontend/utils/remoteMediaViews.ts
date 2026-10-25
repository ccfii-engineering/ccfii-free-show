export interface RemoteMediaView {
    requestId: string
    path: string
    activeRequest?: AbortController
}

export class RemoteMediaViews {
    private views = new Map<string, RemoteMediaView>()

    get(connectionId: string) {
        return this.views.get(connectionId)
    }

    set(connectionId: string, view: RemoteMediaView) {
        this.views.set(connectionId, view)
    }

    forEach(callback: (view: RemoteMediaView, connectionId: string) => void) {
        this.views.forEach(callback)
    }

    closeUnauthorized(isAuthorized: (connectionId: string) => boolean, closeConnection: (connectionId: string) => void) {
        const unauthorized = [...this.views.keys()].filter((connectionId) => !isAuthorized(connectionId))
        unauthorized.forEach((connectionId) => closeConnection(connectionId))
    }

    close(connectionId: string, requestId: string | undefined, closeBackend: () => void) {
        const view = this.views.get(connectionId)
        if (requestId && (!view || view.requestId !== requestId)) return false
        if (view) {
            this.views.delete(connectionId)
            view.activeRequest?.abort()
        }
        closeBackend()
        return true
    }
}
