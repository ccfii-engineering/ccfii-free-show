import { getDocument, GlobalWorkerOptions, version, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist"
import { encodeFilePath } from "../helpers/media"

type PdfRenderSession = {
    jobId: string
    loadingTask: PDFDocumentLoadingTask
    document?: PDFDocumentProxy
    renderTask?: RenderTask
    closing?: Promise<void>
}

type OpenPdfRenderJob = { jobId: string; pdfPath: string }
type RenderPdfPage = { jobId: string; pageIndex: number; maxWidth: number; maxHeight: number; maxPixels: number; format: "png" }

let activeSession: PdfRenderSession | undefined

function getSession(jobId: string) {
    if (!activeSession || activeSession.jobId !== jobId) throw new Error("PDF render job is no longer active")
    return activeSession
}

async function closeSession(session: PdfRenderSession) {
    if (session.closing) return session.closing

    session.closing = (async () => {
        session.renderTask?.cancel()
        session.renderTask = undefined

        const initialDocument = session.document
        if (initialDocument) {
            try {
                await initialDocument.destroy()
            } catch {
                // Destruction is best-effort; the job must still release its slot.
            }
        } else {
            try {
                await session.loadingTask.destroy()
            } catch {
                // A cancelled or failed load may already have destroyed its worker.
            }

            if (session.document) {
                try {
                    await session.document.destroy()
                } catch {
                    // The document may have completed loading as cancellation arrived.
                }
            }
        }

        if (activeSession === session) activeSession = undefined
    })()

    return session.closing
}

export async function openPdfRenderJob({ jobId, pdfPath }: OpenPdfRenderJob, signal?: AbortSignal) {
    if (!jobId || !pdfPath) throw new Error("A PDF render job id and path are required")
    if (signal?.aborted) throw new Error("PDF render job was cancelled")
    if (activeSession) throw new Error("Another PDF render job is already active")

    GlobalWorkerOptions.workerSrc = "./assets/pdf.worker.min.mjs"

    const session: PdfRenderSession = {
        jobId,
        loadingTask: getDocument(encodeFilePath(pdfPath))
    }

    // Register before awaiting the document so an OPEN cancellation can destroy its loading task.
    activeSession = session
    const abortOpen = () => {
        void closeSession(session).catch(() => {})
    }
    signal?.addEventListener("abort", abortOpen, { once: true })

    try {
        session.document = await session.loadingTask.promise
        if (signal?.aborted) throw new Error("PDF render job was cancelled")

        return { pageCount: session.document.numPages, rendererVersion: version }
    } catch (error) {
        await closeSession(session)
        throw error
    } finally {
        signal?.removeEventListener("abort", abortOpen)
    }
}

export async function renderPdfPage({ jobId, pageIndex, maxWidth, maxHeight, maxPixels, format }: RenderPdfPage, signal?: AbortSignal) {
    const session = getSession(jobId)
    if (signal?.aborted) throw new Error("PDF page render was cancelled")
    if (!session.document) throw new Error("PDF render job has not finished opening")
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.document.numPages) throw new Error("PDF page index is out of range")
    if (format !== "png") throw new Error("Only PNG PDF page rendering is supported")

    let page: PDFPageProxy | undefined
    let canvas: HTMLCanvasElement | undefined
    let aborted = signal?.aborted || false
    const abortPage = () => {
        aborted = true
        session.renderTask?.cancel()
    }
    signal?.addEventListener("abort", abortPage, { once: true })

    try {
        page = await session.document.getPage(pageIndex + 1)
        if (aborted || signal?.aborted) throw new Error("PDF page render was cancelled")

        const originalViewport = page.getViewport({ scale: 1 })
        const safeMaxWidth = Math.max(1, Math.floor(Number.isFinite(maxWidth) ? maxWidth : 1))
        const safeMaxHeight = Math.max(1, Math.floor(Number.isFinite(maxHeight) ? maxHeight : 1))
        const safeMaxPixels = Math.max(1, Number.isFinite(maxPixels) ? maxPixels : 1)
        let scale = Math.min(4.5, safeMaxWidth / originalViewport.width, safeMaxHeight / originalViewport.height, Math.sqrt(safeMaxPixels / (originalViewport.width * originalViewport.height)))
        let viewport = page.getViewport({ scale })
        let width = Math.max(1, Math.ceil(viewport.width))
        let height = Math.max(1, Math.ceil(viewport.height))
        while ((width * height > safeMaxPixels || width > safeMaxWidth || height > safeMaxHeight) && scale > 0.001) {
            scale *= 0.999
            viewport = page.getViewport({ scale })
            width = Math.max(1, Math.ceil(viewport.width))
            height = Math.max(1, Math.ceil(viewport.height))
        }
        if (width * height > safeMaxPixels || width > safeMaxWidth || height > safeMaxHeight) throw new Error("PDF page render bounds are too small")

        canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Could not create a canvas for PDF rendering")

        const task = page.render({ canvas, canvasContext: context, viewport })
        session.renderTask = task
        await task.promise
        if (aborted || signal?.aborted) throw new Error("PDF page render was cancelled")

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas!.toBlob((image) => {
                if (image) resolve(image)
                else reject(new Error("Could not encode the rendered PDF page as PNG"))
            }, "image/png")
        })
        if (aborted || signal?.aborted) throw new Error("PDF page render was cancelled")

        return { png: await blob.arrayBuffer(), width: canvas.width, height: canvas.height }
    } finally {
        signal?.removeEventListener("abort", abortPage)
        session.renderTask = undefined
        page?.cleanup()
        if (canvas) {
            canvas.width = 0
            canvas.height = 0
        }
    }
}

export async function closePdfRenderJob({ jobId }: { jobId: string }) {
    if (activeSession?.jobId === jobId) await closeSession(activeSession)
    return { closed: true as const }
}
