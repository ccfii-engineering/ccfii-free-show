interface ReferenceCacheEntry<T> {
    resource: Promise<T>
    references: number
    value?: T
}

export class ReferenceCache<T> {
    private readonly entries = new Map<string, ReferenceCacheEntry<T>>()
    private readonly dispose: (resource: T) => void

    constructor(dispose: (resource: T) => void) {
        this.dispose = dispose
    }

    async acquire(key: string, create: () => Promise<T>): Promise<T> {
        const existing = this.entries.get(key)
        if (existing) {
            existing.references++
            return existing.resource
        }

        const entry: ReferenceCacheEntry<T> = { resource: create(), references: 1 }
        this.entries.set(key, entry)
        try {
            const value = await entry.resource
            entry.value = value
            return value
        } catch (error) {
            if (this.entries.get(key) === entry) this.entries.delete(key)
            throw error
        }
    }

    release(key: string): void {
        const entry = this.entries.get(key)
        if (!entry) return

        entry.references--
        if (entry.references > 0) return

        this.entries.delete(key)
        if (entry.value !== undefined) this.dispose(entry.value)
        else entry.resource.then(this.dispose).catch(() => undefined)
    }

    clear(): void {
        for (const entry of this.entries.values()) {
            if (entry.value !== undefined) this.dispose(entry.value)
            else entry.resource.then(this.dispose).catch(() => undefined)
        }
        this.entries.clear()
    }

    snapshot(): { entries: number; references: number } {
        return {
            entries: this.entries.size,
            references: [...this.entries.values()].reduce((total, entry) => total + entry.references, 0)
        }
    }
}
