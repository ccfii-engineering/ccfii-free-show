export class FolderScanQueueFullError extends Error {
    constructor() {
        super("Folder scan queue is full")
        this.name = "FolderScanQueueFullError"
    }
}

export function createAbortError() {
    const error = new Error("Folder scan cancelled")
    error.name = "AbortError"
    return error
}

type ScheduledTask<T> = {
    operation: () => Promise<T>
    signal?: AbortSignal
    resolve: (value: T) => void
    reject: (error: Error) => void
    abortQueued: () => void
    started: boolean
}

export class FolderScanScheduler {
    private active = 0
    private queue: ScheduledTask<unknown>[] = []
    readonly maxActive: number
    readonly maxQueued: number

    constructor(maxActive = 2, maxQueued = 2) {
        this.maxActive = maxActive
        this.maxQueued = maxQueued
    }

    get activeCount() {
        return this.active
    }

    get queuedCount() {
        return this.queue.length
    }

    run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) return Promise.reject(createAbortError())

        return new Promise<T>((resolve, reject) => {
            const task: ScheduledTask<T> = {
                operation,
                signal,
                resolve,
                reject,
                abortQueued: () => undefined,
                started: false
            }

            task.abortQueued = () => {
                if (task.started) return
                const index = this.queue.indexOf(task as ScheduledTask<unknown>)
                if (index < 0) return
                this.queue.splice(index, 1)
                signal?.removeEventListener("abort", task.abortQueued)
                reject(createAbortError())
                this.drain()
            }

            if (this.active < this.maxActive && this.queue.length === 0) {
                this.start(task)
                return
            }

            if (this.queue.length >= this.maxQueued) {
                reject(new FolderScanQueueFullError())
                return
            }

            this.queue.push(task as ScheduledTask<unknown>)
            signal?.addEventListener("abort", task.abortQueued, { once: true })
        })
    }

    private start<T>(task: ScheduledTask<T>) {
        if (task.signal?.aborted) {
            task.abortQueued()
            return
        }

        task.started = true
        task.signal?.removeEventListener("abort", task.abortQueued)
        this.active++

        void Promise.resolve()
            .then(task.operation)
            .then(task.resolve, (error) => task.reject(error instanceof Error ? error : new Error(String(error))))
            .finally(() => {
                this.active--
                this.drain()
            })
    }

    private drain() {
        while (this.active < this.maxActive && this.queue.length) {
            const next = this.queue.shift()!
            this.start(next)
        }
    }
}
