import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import type { Dir } from "fs"
import type { RemoteMediaItem, RemoteMediaKind, RemoteMediaPage, RemoteMediaResolvedPath } from "../../types/remote/control"
import { audioExtensions, imageExtensions, videoExtensions } from "../data/media"

const PAGE_SIZE = 40
const PAGE_SCAN_LIMIT = 400
const MAX_SESSIONS = 4
const MAX_DIRECTORY_HANDLES = 4
const MAX_PAGE_OPERATIONS = 2
const MAX_THUMBNAIL_OPERATIONS = 4
const MAX_THUMBNAILS_PER_CONNECTION = 2
const MAX_CACHED_PAGES = 6
const SESSION_TTL_MS = 60000
const MAX_PATH_LENGTH = 4096
const MAX_NAME_LENGTH = 255
const MAX_REQUEST_ID_LENGTH = 128
const MAX_THUMBNAIL_FILE_BYTES = 750 * 1024

export class RemoteMediaError extends Error {
    code: "busy" | "invalid_path" | "cursor_expired" | "restart_required" | "not_media" | "too_large" | "unavailable"

    constructor(code: RemoteMediaError["code"], message = code) {
        super(message)
        this.name = "RemoteMediaError"
        this.code = code
    }
}

export interface RemoteMediaRoot {
    id: string
    name: string
    path: string
}

export interface RemoteMediaBrowserOptions {
    getRoots: () => RemoteMediaRoot[]
    isConnectionActive: (connectionId: string, server: "REMOTE" | "CONTROLLER") => boolean
    makeThumbnail: (path: string) => Promise<string>
    openDirectory?: (path: string) => Promise<Dir>
}

type CachedPage = RemoteMediaPage
type SessionStartToken = {
    connectionId: string
    requestId: string
    cancelled: boolean
}
type RootSourceSnapshot = {
    roots: RemoteMediaRoot[]
    fingerprint: string
}
type RemoteMediaSession = {
    connectionId: string
    requestId: string
    token: SessionStartToken
    path: string
    parentPath: string
    roots: string[]
    rootFingerprint: string
    rootSourceFingerprint: string
    dir?: Dir
    rootSources?: RemoteMediaRoot[]
    rootIndex: number
    page: number
    cursor: string | null
    pages: Map<number, CachedPage>
    busy: boolean
    lastUsed: number
    idleTimer: NodeJS.Timeout
    retired: boolean
    retirement?: Promise<void>
}

type MediaPath = RemoteMediaResolvedPath

export class RemoteMediaBrowser {
    private sessions = new Map<string, RemoteMediaSession>()
    private sessionStarts = new Map<string, SessionStartToken>()
    private reservedDirectoryOwners = new Map<string, SessionStartToken>()
    private closingDirectoryHandles = 0
    private activePageOperations = 0
    private activeThumbnailOperations = 0
    private thumbnailOperationsByConnection = new Map<string, number>()

    constructor(private options: RemoteMediaBrowserOptions) {}

    async page(data: { connectionId: string; requestId: string; path: string; page: number; cursor?: string }, signal?: AbortSignal): Promise<RemoteMediaPage> {
        this.assertConnection(data.connectionId, "REMOTE")
        this.assertRequest(data.requestId, data.path, data.page)
        this.throwIfAborted(signal)
        if (data.page === 0 && this.sessionStarts.has(data.connectionId)) throw new RemoteMediaError("busy")

        if (this.activePageOperations >= MAX_PAGE_OPERATIONS) throw new RemoteMediaError("busy")
        this.activePageOperations++
        const startToken: SessionStartToken | undefined = data.page === 0 ? { connectionId: data.connectionId, requestId: data.requestId, cancelled: false } : undefined
        if (data.page === 0) {
            this.sessionStarts.set(data.connectionId, startToken!)
            if (data.path) this.reservedDirectoryOwners.set(data.connectionId, startToken!)
        }
        let session = data.page === 0 ? undefined : this.sessions.get(data.connectionId)
        const token = startToken || session?.token
        const onAbort = () => {
            if (token) token.cancelled = true
            if (session) void this.retireSession(session)
        }
        signal?.addEventListener("abort", onAbort, { once: true })
        try {
            if (data.page === 0) {
                const previous = this.sessions.get(data.connectionId)
                if (previous) await this.retireSession(previous)
                this.assertStartActive(startToken!, signal)
                await this.makeSessionOwnerRoom(data.connectionId)
                this.assertStartActive(startToken!, signal)
                if (data.path) await this.makeDirectoryHandleRoom(data.connectionId)
                this.assertStartActive(startToken!, signal)
                session = await this.createSession(startToken!, data.path, signal)
            } else if (!session || session.requestId !== data.requestId || session.path !== data.path) {
                throw new RemoteMediaError("cursor_expired")
            }

            if (!session) throw new RemoteMediaError("cursor_expired")
            this.assertSessionStatus(session, signal)
            const roots = await this.getSessionRoots(session, signal)
            this.assertSessionStatus(session, signal)
            this.touch(session)

            const cached = session.pages.get(data.page)
            if (cached) {
                await this.assertCachedPageAuthorized(session, cached, roots, signal)
                await this.assertRootVersionCurrent(session, roots, signal)
                this.assertSessionRootSourceVersion(session)
                this.assertSessionStatus(session, signal)
                this.touch(session)
                return { ...cached, items: cached.items.slice() }
            }
            if (session.busy) throw new RemoteMediaError("busy")
            if (data.page !== session.page + 1) throw new RemoteMediaError("restart_required")
            if (data.page > 0 && (!data.cursor || data.cursor !== session.cursor)) throw new RemoteMediaError("cursor_expired")

            session.busy = true
            clearTimeout(session.idleTimer)
            try {
                const page = session.rootSources ? await this.readRootsPage(session, data.page, roots, signal) : await this.readDirectoryPage(session, data.page, roots, signal)
                this.assertSessionStatus(session, signal)
                await this.assertRootVersionCurrent(session, roots, signal)
                this.assertSessionRootSourceVersion(session)
                this.assertSessionStatus(session, signal)

                session.page = data.page
                session.cursor = page.nextCursor
                session.pages.set(page.page, page)
                while (session.pages.size > MAX_CACHED_PAGES) session.pages.delete(session.pages.keys().next().value!)
                this.touch(session)
                return { ...page, items: page.items.slice() }
            } catch (error) {
                if (signal?.aborted || token?.cancelled || !this.options.isConnectionActive(data.connectionId, "REMOTE") || this.sessions.get(data.connectionId) !== session) {
                    await this.retireSession(session)
                }
                throw error
            } finally {
                session.busy = false
                if (this.sessions.get(data.connectionId) === session) this.touch(session)
            }
        } catch (error) {
            if (session && (signal?.aborted || token?.cancelled || !this.options.isConnectionActive(data.connectionId, "REMOTE") || this.sessions.get(data.connectionId) !== session)) {
                await this.retireSession(session)
            }
            throw error
        } finally {
            signal?.removeEventListener("abort", onAbort)
            if (startToken && this.sessionStarts.get(data.connectionId) === startToken) {
                this.sessionStarts.delete(data.connectionId)
                this.releaseDirectoryReservation(startToken)
            }
            this.activePageOperations--
        }
    }

    async resolve(connectionId: string, inputPath: string, expectedKind?: RemoteMediaKind): Promise<MediaPath> {
        this.assertConnection(connectionId, "REMOTE")
        const resolved = await this.resolveMediaPath(inputPath, expectedKind)
        this.assertConnection(connectionId, "REMOTE")
        return resolved
    }

    async thumbnail(connectionId: string, inputPath: string): Promise<{ path: string; thumbnail: string }> {
        return this.withThumbnailLimit(connectionId, "REMOTE", async () => {
            const resolved = await this.resolveMediaPath(inputPath)
            return this.buildThumbnail(connectionId, "REMOTE", resolved.path, async () => {
                await this.resolveMediaPath(resolved.path)
            })
        })
    }

    async snapshotThumbnail(connectionId: string, inputPath: string): Promise<{ path: string; thumbnail: string }> {
        return this.withThumbnailLimit(connectionId, "CONTROLLER", async () => {
            const resolved = await this.resolveSnapshotAsset(inputPath)
            return this.buildThumbnail(connectionId, "CONTROLLER", resolved.path, async () => {
                const current = await this.resolveSnapshotAsset(resolved.path)
                if (current.path !== resolved.path) throw new RemoteMediaError("invalid_path")
            })
        })
    }

    async close(connectionId: string, requestId?: string) {
        const startToken = this.sessionStarts.get(connectionId)
        if (startToken && (!requestId || startToken.requestId === requestId)) startToken.cancelled = true
        const session = this.sessions.get(connectionId)
        if (!session || (requestId && session.requestId !== requestId)) return
        await this.retireSession(session)
    }

    async closeAll() {
        this.sessionStarts.forEach((token) => (token.cancelled = true))
        await Promise.all([...this.sessions.values()].map((session) => this.retireSession(session)))
    }

    private async createSession(token: SessionStartToken, inputPath: string, signal?: AbortSignal): Promise<RemoteMediaSession> {
        const { connectionId, requestId } = token
        const rootSnapshot = this.captureRootSourceSnapshot()
        const roots = await this.getCanonicalRoots(rootSnapshot.roots)
        this.assertRootSourceVersion(rootSnapshot.fingerprint)
        this.assertStartActive(token, signal)

        let canonicalPath = ""
        let parentPath = ""
        let dir: Dir | undefined
        let rootSources: RemoteMediaRoot[] | undefined
        const rootFingerprint = this.getRootFingerprint(roots)

        if (!inputPath) {
            rootSources = rootSnapshot.roots
            this.assertStartActive(token, signal)
            canonicalPath = ""
            parentPath = ""
        } else {
            const resolved = await this.resolveDirectoryPath(inputPath, roots)
            this.assertRootSourceVersion(rootSnapshot.fingerprint)
            this.assertStartActive(token, signal)
            canonicalPath = resolved.path
            parentPath = roots.some((root) => root.canonicalPath === canonicalPath) ? "" : path.dirname(canonicalPath)
            dir = await (this.options.openDirectory || ((directoryPath) => fs.promises.opendir(directoryPath, { bufferSize: 32 })))(canonicalPath)
        }

        let currentRoots: { path: string; canonicalPath: string }[]
        try {
            const currentRootSnapshot = this.captureRootSourceSnapshot()
            this.assertRootSourceVersion(rootSnapshot.fingerprint)
            currentRoots = await this.getCanonicalRoots(currentRootSnapshot.roots)
            this.assertRootSourceVersion(rootSnapshot.fingerprint)
            this.assertStartActive(token, signal)
            if (rootFingerprint !== this.getRootFingerprint(currentRoots)) throw new RemoteMediaError("cursor_expired")
        } catch (error) {
            if (dir) await this.closeUnattachedDirectory(dir)
            throw error
        }

        const session: RemoteMediaSession = {
            connectionId,
            requestId,
            token,
            path: canonicalPath,
            parentPath,
            roots: roots.map((root) => root.canonicalPath),
            rootFingerprint,
            rootSourceFingerprint: rootSnapshot.fingerprint,
            dir,
            rootSources,
            rootIndex: 0,
            page: -1,
            cursor: null,
            pages: new Map(),
            busy: false,
            lastUsed: Date.now(),
            idleTimer: setTimeout(() => void this.expireSession(session), SESSION_TTL_MS),
            retired: false
        }
        session.idleTimer.unref?.()
        try {
            this.assertRootSourceVersion(rootSnapshot.fingerprint)
            this.assertStartActive(token, signal)
        } catch (error) {
            clearTimeout(session.idleTimer)
            if (dir) await this.closeUnattachedDirectory(dir)
            throw error
        }
        this.sessions.set(connectionId, session)
        if (inputPath) this.releaseDirectoryReservation(token)
        return session
    }

    private async readRootsPage(session: RemoteMediaSession, pageIndex: number, canonicalRoots: { path: string; canonicalPath: string }[], signal?: AbortSignal): Promise<RemoteMediaPage> {
        const items: RemoteMediaItem[] = []
        const seen = new Set<string>()
        let scanned = 0
        while (session.rootIndex < (session.rootSources?.length || 0) && scanned < PAGE_SCAN_LIMIT && items.length < PAGE_SIZE) {
            this.assertSessionStatus(session, signal)
            const root = session.rootSources![session.rootIndex++]
            scanned++
            if (!root?.path || root.name?.length > MAX_NAME_LENGTH) continue
            const canonicalRoot = canonicalRoots.find((item) => item.path === root.path)?.canonicalPath
            if (!canonicalRoot || canonicalRoot.length > MAX_PATH_LENGTH || seen.has(canonicalRoot)) continue
            seen.add(canonicalRoot)
            const stats = await fs.promises.stat(canonicalRoot)
            items.push({ path: canonicalRoot, name: root.name || path.basename(canonicalRoot), kind: "folder", size: 0, modifiedAt: stats.mtimeMs })
        }
        const hasMore = session.rootIndex < (session.rootSources?.length || 0)
        return {
            requestId: session.requestId,
            path: "",
            parentPath: "",
            page: pageIndex,
            items,
            nextCursor: hasMore ? randomUUID() : null,
            hasMore
        }
    }

    private async readDirectoryPage(session: RemoteMediaSession, pageIndex: number, roots: { path: string; canonicalPath: string }[], signal?: AbortSignal): Promise<RemoteMediaPage> {
        const items: RemoteMediaItem[] = []
        let scanned = 0
        let reachedEnd = false

        while (scanned < PAGE_SCAN_LIMIT && items.length < PAGE_SIZE) {
            this.assertSessionStatus(session, signal)
            const entry = await session.dir?.read()
            this.assertSessionStatus(session, signal)
            if (!entry) {
                reachedEnd = true
                break
            }
            scanned++
            if (entry.name.length > MAX_NAME_LENGTH || entry.name.startsWith(".")) continue

            const entryPath = path.join(session.path, entry.name)
            if (entryPath.length > MAX_PATH_LENGTH) continue
            try {
                const realPath = await fs.promises.realpath(entryPath)
                this.assertSessionStatus(session, signal)
                if (
                    !this.isWithinAny(
                        realPath,
                        roots.map((root) => root.canonicalPath)
                    )
                )
                    continue
                const stats = await fs.promises.stat(realPath)
                this.assertSessionStatus(session, signal)
                const kind = stats.isDirectory() ? "folder" : this.mediaKind(realPath)
                if (!kind) continue
                items.push({ path: realPath, name: entry.name, kind, size: stats.isDirectory() ? 0 : stats.size, modifiedAt: stats.mtimeMs })
            } catch {
                // Files can disappear while a remote page is being read; skip the stale entry.
            }
        }

        if (reachedEnd) await this.closeDirectory(session)
        const hasMore = !reachedEnd
        return {
            requestId: session.requestId,
            path: session.path,
            parentPath: session.parentPath,
            page: pageIndex,
            items,
            nextCursor: hasMore ? randomUUID() : null,
            hasMore
        }
    }

    private async resolveMediaPath(inputPath: string, expectedKind?: RemoteMediaKind): Promise<MediaPath> {
        if (typeof inputPath !== "string" || !inputPath || inputPath.length > MAX_PATH_LENGTH || !path.isAbsolute(inputPath)) throw new RemoteMediaError("invalid_path")
        const rootSnapshot = this.captureRootSourceSnapshot()
        const roots = await this.getCanonicalRoots(rootSnapshot.roots)
        this.assertRootSourceVersion(rootSnapshot.fingerprint)
        let canonicalPath = ""
        try {
            canonicalPath = await fs.promises.realpath(inputPath)
        } catch {
            throw new RemoteMediaError("invalid_path")
        }
        this.assertRootSourceVersion(rootSnapshot.fingerprint)
        if (
            !this.isWithinAny(
                canonicalPath,
                roots.map((root) => root.canonicalPath)
            )
        )
            throw new RemoteMediaError("invalid_path")

        const stats = await fs.promises.stat(canonicalPath)
        const kind = this.mediaKind(canonicalPath)
        if (stats.isDirectory() || !kind || (expectedKind && expectedKind !== kind)) throw new RemoteMediaError("not_media")
        this.assertRootSourceVersion(rootSnapshot.fingerprint)
        return { path: canonicalPath, kind, size: stats.size, modifiedAt: stats.mtimeMs }
    }

    private async resolveSnapshotAsset(inputPath: string): Promise<MediaPath> {
        if (typeof inputPath !== "string" || !inputPath || inputPath.length > MAX_PATH_LENGTH || !path.isAbsolute(inputPath)) throw new RemoteMediaError("invalid_path")
        let canonicalPath = ""
        try {
            canonicalPath = await fs.promises.realpath(inputPath)
        } catch {
            throw new RemoteMediaError("invalid_path")
        }
        const stats = await fs.promises.stat(canonicalPath)
        const kind = this.mediaKind(canonicalPath)
        if (stats.isDirectory() || (kind !== "image" && kind !== "video")) throw new RemoteMediaError("not_media")
        return { path: canonicalPath, kind, size: stats.size, modifiedAt: stats.mtimeMs }
    }

    private async buildThumbnail(connectionId: string, server: "REMOTE" | "CONTROLLER", canonicalPath: string, revalidate: () => Promise<void>) {
        this.assertConnection(connectionId, server)
        await revalidate()
        this.assertConnection(connectionId, server)
        const thumbnailPath = await this.options.makeThumbnail(canonicalPath)
        this.assertConnection(connectionId, server)
        await revalidate()
        this.assertConnection(connectionId, server)
        if (!thumbnailPath) throw new RemoteMediaError("unavailable")

        const file = await fs.promises.open(thumbnailPath, "r")
        try {
            const stats = await file.stat()
            if (stats.size > MAX_THUMBNAIL_FILE_BYTES) throw new RemoteMediaError("too_large")
            const content = Buffer.alloc(stats.size)
            const { bytesRead } = await file.read(content, 0, stats.size, 0)
            if (bytesRead !== stats.size || bytesRead > MAX_THUMBNAIL_FILE_BYTES) throw new RemoteMediaError("too_large")
            this.assertConnection(connectionId, server)
            return { path: canonicalPath, thumbnail: `data:image/png;base64,${content.toString("base64")}` }
        } finally {
            await file.close()
        }
    }

    private async withThumbnailLimit<T>(connectionId: string, server: "REMOTE" | "CONTROLLER", work: () => Promise<T>): Promise<T> {
        this.assertConnection(connectionId, server)
        const activeForConnection = this.thumbnailOperationsByConnection.get(connectionId) || 0
        if (activeForConnection >= MAX_THUMBNAILS_PER_CONNECTION || this.activeThumbnailOperations >= MAX_THUMBNAIL_OPERATIONS) throw new RemoteMediaError("busy")

        this.activeThumbnailOperations++
        this.thumbnailOperationsByConnection.set(connectionId, activeForConnection + 1)
        try {
            return await work()
        } finally {
            this.activeThumbnailOperations--
            const remaining = (this.thumbnailOperationsByConnection.get(connectionId) || 1) - 1
            if (remaining) this.thumbnailOperationsByConnection.set(connectionId, remaining)
            else this.thumbnailOperationsByConnection.delete(connectionId)
        }
    }

    private async resolveDirectoryPath(inputPath: string, roots: Awaited<ReturnType<RemoteMediaBrowser["getCanonicalRoots"]>>) {
        if (typeof inputPath !== "string" || !inputPath || inputPath.length > MAX_PATH_LENGTH || !path.isAbsolute(inputPath)) throw new RemoteMediaError("invalid_path")
        let canonicalPath = ""
        try {
            canonicalPath = await fs.promises.realpath(inputPath)
        } catch {
            throw new RemoteMediaError("invalid_path")
        }
        if (
            !this.isWithinAny(
                canonicalPath,
                roots.map((root) => root.canonicalPath)
            )
        )
            throw new RemoteMediaError("invalid_path")
        const stats = await fs.promises.stat(canonicalPath)
        if (!stats.isDirectory()) throw new RemoteMediaError("invalid_path")
        return { path: canonicalPath }
    }

    private async getCanonicalRoots(sources: RemoteMediaRoot[]) {
        const roots: { path: string; canonicalPath: string }[] = []
        const seen = new Set<string>()
        for (const root of sources) {
            if (!root?.path || root.path.length > MAX_PATH_LENGTH) continue
            try {
                const canonicalPath = await fs.promises.realpath(root.path)
                if (seen.has(canonicalPath) || !(await fs.promises.stat(canonicalPath)).isDirectory()) continue
                seen.add(canonicalPath)
                roots.push({ path: root.path, canonicalPath })
            } catch {
                // A configured root may be on a disconnected drive.
            }
        }
        return roots
    }

    private mediaKind(inputPath: string): Exclude<RemoteMediaKind, "folder"> | null {
        const extension = path.extname(inputPath).slice(1).toLowerCase()
        if (imageExtensions.includes(extension)) return "image"
        if (videoExtensions.includes(extension)) return "video"
        if (audioExtensions.includes(extension)) return "audio"
        return null
    }

    private isWithinAny(inputPath: string, roots: string[]) {
        return roots.some((root) => {
            const relative = path.relative(root, inputPath)
            return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        })
    }

    private assertConnection(connectionId: string, server: "REMOTE" | "CONTROLLER") {
        if (typeof connectionId !== "string" || !connectionId || connectionId.length > MAX_REQUEST_ID_LENGTH || !this.options.isConnectionActive(connectionId, server)) {
            throw new RemoteMediaError("unavailable")
        }
    }

    private assertRequest(requestId: string, inputPath: string, page: number) {
        if (typeof requestId !== "string" || !requestId || requestId.length > MAX_REQUEST_ID_LENGTH) throw new RemoteMediaError("cursor_expired")
        if (typeof inputPath !== "string" || inputPath.length > MAX_PATH_LENGTH) throw new RemoteMediaError("invalid_path")
        if (!Number.isSafeInteger(page) || page < 0) throw new RemoteMediaError("cursor_expired")
    }

    private throwIfAborted(signal?: AbortSignal, token?: SessionStartToken) {
        if (signal?.aborted || token?.cancelled) {
            const error = new Error("Remote media operation cancelled")
            error.name = "AbortError"
            throw error
        }
    }

    private assertStartActive(token: SessionStartToken, signal?: AbortSignal) {
        this.throwIfAborted(signal, token)
        if (this.sessionStarts.get(token.connectionId) !== token) throw new RemoteMediaError("cursor_expired")
        this.assertConnection(token.connectionId, "REMOTE")
    }

    private assertSessionStatus(session: RemoteMediaSession, signal?: AbortSignal) {
        this.throwIfAborted(signal, session.token)
        this.assertConnection(session.connectionId, "REMOTE")
        if (session.retired || this.sessions.get(session.connectionId) !== session) throw new RemoteMediaError("cursor_expired")
    }

    private async getSessionRoots(session: RemoteMediaSession, signal?: AbortSignal) {
        this.assertSessionStatus(session, signal)
        const rootSnapshot = this.captureRootSourceSnapshot()
        this.assertSessionRootSourceVersion(session, rootSnapshot.fingerprint)
        const roots = await this.getCanonicalRoots(rootSnapshot.roots)
        this.assertSessionRootSourceVersion(session, rootSnapshot.fingerprint)
        this.assertSessionStatus(session, signal)
        if (this.getRootFingerprint(roots) !== session.rootFingerprint) {
            void this.retireSession(session)
            throw new RemoteMediaError("cursor_expired")
        }

        if (session.path) {
            try {
                const resolved = await this.resolveDirectoryPath(session.path, roots)
                this.assertSessionRootSourceVersion(session, rootSnapshot.fingerprint)
                this.assertSessionStatus(session, signal)
                if (resolved.path !== session.path) throw new RemoteMediaError("invalid_path")
            } catch (error) {
                void this.retireSession(session)
                throw error
            }
        }
        return roots
    }

    private async assertRootVersionCurrent(session: RemoteMediaSession, operationRoots: { path: string; canonicalPath: string }[], signal?: AbortSignal) {
        this.assertSessionStatus(session, signal)
        const rootSnapshot = this.captureRootSourceSnapshot()
        this.assertSessionRootSourceVersion(session, rootSnapshot.fingerprint)
        const roots = await this.getCanonicalRoots(rootSnapshot.roots)
        this.assertSessionRootSourceVersion(session, rootSnapshot.fingerprint)
        this.assertSessionStatus(session, signal)
        if (this.getRootFingerprint(operationRoots) !== session.rootFingerprint || this.getRootFingerprint(roots) !== session.rootFingerprint) {
            void this.retireSession(session)
            throw new RemoteMediaError("cursor_expired")
        }
    }

    private async assertCachedPageAuthorized(session: RemoteMediaSession, page: CachedPage, roots: { path: string; canonicalPath: string }[], signal?: AbortSignal) {
        try {
            for (const item of page.items) {
                this.assertSessionStatus(session, signal)
                const canonicalPath = await fs.promises.realpath(item.path)
                this.assertSessionStatus(session, signal)
                if (
                    canonicalPath !== item.path ||
                    !this.isWithinAny(
                        canonicalPath,
                        roots.map((root) => root.canonicalPath)
                    )
                ) {
                    throw new RemoteMediaError("invalid_path")
                }
                const stats = await fs.promises.stat(canonicalPath)
                this.assertSessionStatus(session, signal)
                const kind = stats.isDirectory() ? "folder" : this.mediaKind(canonicalPath)
                if (!kind || kind !== item.kind) throw new RemoteMediaError("invalid_path")
            }
        } catch (error) {
            await this.retireSession(session)
            throw error instanceof RemoteMediaError && error.code === "unavailable" ? error : new RemoteMediaError("cursor_expired")
        }
    }

    private getRootFingerprint(roots: { canonicalPath: string }[]) {
        return roots
            .map((root) => root.canonicalPath)
            .sort()
            .join("\n")
    }

    private captureRootSourceSnapshot(): RootSourceSnapshot {
        const roots = this.options.getRoots().map((root) => ({ ...root }))
        return { roots, fingerprint: this.getRootSourceFingerprint(roots) }
    }

    private getRootSourceFingerprint(roots: RemoteMediaRoot[]) {
        return JSON.stringify(roots.map(({ id, name, path: rootPath }) => [id, name, rootPath]))
    }

    private assertRootSourceVersion(fingerprint: string) {
        if (this.getRootSourceFingerprint(this.options.getRoots()) !== fingerprint) throw new RemoteMediaError("cursor_expired")
    }

    private assertSessionRootSourceVersion(session: RemoteMediaSession, fingerprint = session.rootSourceFingerprint) {
        try {
            this.assertRootSourceVersion(fingerprint)
        } catch (error) {
            void this.retireSession(session)
            throw error
        }
    }

    private releaseDirectoryReservation(token: SessionStartToken) {
        if (this.reservedDirectoryOwners.get(token.connectionId) === token) this.reservedDirectoryOwners.delete(token.connectionId)
    }

    private async closeUnattachedDirectory(dir: Dir) {
        this.closingDirectoryHandles++
        try {
            await dir.close()
        } catch {
            // A failed or cancelled directory read may have already closed the handle.
        } finally {
            this.closingDirectoryHandles--
        }
    }

    private touch(session: RemoteMediaSession) {
        session.lastUsed = Date.now()
        clearTimeout(session.idleTimer)
        if (session.busy) return
        session.idleTimer = setTimeout(() => void this.expireSession(session), SESSION_TTL_MS)
        session.idleTimer.unref?.()
    }

    private async expireSession(session: RemoteMediaSession) {
        if (this.sessions.get(session.connectionId) !== session) return
        await this.retireSession(session)
    }

    private async closeDirectory(session: RemoteMediaSession) {
        const dir = session.dir
        session.dir = undefined
        if (!dir) return
        this.closingDirectoryHandles++
        try {
            await dir.close()
        } catch {
            // The iterator may already have closed at EOF.
        } finally {
            this.closingDirectoryHandles--
        }
    }

    private retireSession(session: RemoteMediaSession): Promise<void> {
        if (session.retirement) return session.retirement
        session.retired = true
        session.token.cancelled = true
        if (this.sessions.get(session.connectionId) === session) this.sessions.delete(session.connectionId)
        clearTimeout(session.idleTimer)
        session.pages.clear()
        session.rootSources = undefined
        session.retirement = this.closeDirectory(session)
        return session.retirement
    }

    private async makeSessionOwnerRoom(reservedConnectionId: string) {
        const owners = () => new Set([...this.sessions.keys(), ...this.sessionStarts.keys()])
        while (owners().size > MAX_SESSIONS) {
            const candidates = [...this.sessions.values()].filter((session) => session.connectionId !== reservedConnectionId && !this.sessionStarts.has(session.connectionId) && !session.busy).sort((a, b) => a.lastUsed - b.lastUsed)
            const candidate = candidates[0]
            if (!candidate) throw new RemoteMediaError("busy")
            await this.retireSession(candidate)
        }
    }

    private async makeDirectoryHandleRoom(reservedConnectionId: string) {
        while (this.directoryHandleCount() > MAX_DIRECTORY_HANDLES) {
            const candidates = [...this.sessions.values()].filter((session) => session.connectionId !== reservedConnectionId && !this.sessionStarts.has(session.connectionId) && !!session.dir && !session.busy).sort((a, b) => a.lastUsed - b.lastUsed)
            const candidate = candidates[0]
            if (!candidate) throw new RemoteMediaError("busy")
            await this.retireSession(candidate)
        }
    }

    private directoryHandleCount() {
        return this.reservedDirectoryOwners.size + this.closingDirectoryHandles + [...this.sessions.values()].filter((session) => !!session.dir).length
    }
}

export const remoteMediaLimits = {
    pageSize: PAGE_SIZE,
    pageScanLimit: PAGE_SCAN_LIMIT,
    maxSessions: MAX_SESSIONS,
    maxDirectoryHandles: MAX_DIRECTORY_HANDLES,
    maxPageOperations: MAX_PAGE_OPERATIONS,
    maxThumbnailOperations: MAX_THUMBNAIL_OPERATIONS,
    maxThumbnailsPerConnection: MAX_THUMBNAILS_PER_CONNECTION,
    maxCachedPages: MAX_CACHED_PAGES,
    sessionTtlMs: SESSION_TTL_MS,
    maxThumbnailFileBytes: MAX_THUMBNAIL_FILE_BYTES
} as const
