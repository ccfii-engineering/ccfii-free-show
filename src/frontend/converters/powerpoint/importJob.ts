import { Main, type MainSendValue, type PowerPointImportOutcome } from "../../../types/IPC/Main"
import { activePopup, alertMessage, pdfImportControllers, pdfImports } from "../../stores"

const IMPORT_TIMEOUT_MS = 30 * 60 * 1000

type ImportPayload = MainSendValue<Main.IMPORT> | MainSendValue<Main.IMPORT_FILES>

function escapeHtml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

function showImportError(title: string, message: string) {
    alertMessage.set(`<h3>${escapeHtml(title)}</h3><br>${escapeHtml(message)}`)
    activePopup.set("alert")
}

export function showPdfImportError(message: string) {
    showImportError("PDF import failed", message)
}

function showOutcome(outcome: PowerPointImportOutcome | undefined) {
    if (!outcome || outcome.status === "complete" || outcome.status === "cancelled") return

    if (outcome.status === "renderer-unavailable") {
        showImportError("PowerPoint import failed", outcome.message)
        return
    }

    showImportError("PowerPoint import failed", outcome.message)
}

export async function runRenderedPowerPointImport(payload: ImportPayload) {
    if (pdfImportControllers.size) return

    const controller = new AbortController()
    pdfImportControllers.set("powerpoint", controller)

    try {
        const { requestMainResult } = await import("../../IPC/main")
        const result = "channel" in payload ? await requestMainResult(Main.IMPORT, payload, { signal: controller.signal, timeoutMs: IMPORT_TIMEOUT_MS }) : await requestMainResult(Main.IMPORT_FILES, payload, { signal: controller.signal, timeoutMs: IMPORT_TIMEOUT_MS })

        if (result.status === "success") {
            showOutcome(result.data)
        } else if (result.status === "timeout") {
            showImportError("PowerPoint import status unknown", "The import timed out, so its final status is unknown. Check your show list before trying again.")
        } else if (result.status === "error") {
            showImportError("PowerPoint import failed", result.error.message)
        }
    } finally {
        if (pdfImportControllers.get("powerpoint") === controller) pdfImportControllers.delete("powerpoint")
        pdfImports.update((imports) => {
            const cleaned = new Map(imports)
            for (const [key, progress] of cleaned) {
                if (progress.cancelController === controller && progress.status === "importing") cleaned.delete(key)
            }
            return cleaned
        })
    }
}
