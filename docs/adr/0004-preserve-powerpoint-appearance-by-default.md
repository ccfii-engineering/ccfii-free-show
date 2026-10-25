---
status: accepted
decision_updated: 2026-10-25
implementation: complete
portable_renderer_validation: automated_passed
platform_validation: ci_runtime_gate
introduced_in: 1.13.5
---

# Preserve PowerPoint appearance by default

## Decision

PowerPoint imports default to static rendered slide images so layout and appearance are retained. The default `.pptx` path uses the MIT-licensed `@web-ppt/core` 0.4.5 package inside FreeShow's bundled Electron renderer. It must work offline and must not require LibreOffice, a PowerPoint/Office installation, a network service, or a separately installed engine. PDF imports continue through the existing PDF.js path; existing PDF-conversion choices remain separate. Editable conversion remains an explicit user choice.

This decision update supersedes the earlier LibreOffice-based default and the earlier prohibition on adding a renderer. It does not require or invoke the explicit LibreOffice conversion option for normal `.pptx` image imports. A render failure reports an error; it never silently switches to editable conversion.

The portable image path supports `.pptx` only. Legacy `.ppt` and macro-enabled `.pptm` are unsupported there until authentic format-specific fixtures and compatibility checks pass. The existing editable route remains a separate choice. No VBA is executed.

## Import contract

Keep a managed copy of the original deck and render one page at a time to PNG, bounded to 1920 × 1080 and 2,073,600 pixels. Key reusable pages by source hash, renderer version, and resolution. The renderer version includes `@web-ppt/core`, Electron, and Chromium versions. `ImportSource.pdfPath` is optional: PDF records retain their PDF path, while PowerPoint records use the managed deck as the render source.

Use local system fonts and usable embedded fonts. The renderer has no CDN font dependency. MTX-compressed EOT fonts cannot be decoded and fall back to available fonts; unsupported features or missing fonts may change layout. Static pages do not retain motion, audio, or transitions, and the result is not claimed to match PowerPoint pixel-for-pixel.

## Isolation and resource limits

Run PowerPoint parsing in a hidden, per-job, non-persistent Electron renderer with a unique token. Keep Node integration disabled, sandbox the renderer, block network requests, verify that its OS process differs from the FreeShow UI process, and force-close the job on abort or timeout. The main process owns the typed `OPEN(bytes)`, `PAGE`, and `CLOSE` requests and accepts replies only from that job's renderer.

Preflight `.pptx` archives in a worker before parsing. Current limits are 100 MiB source size, 10,000 ZIP entries, 64 MiB per entry, 512 MiB actual inflated size, 500 slides, 40 million pixels per raster image or SVG, 160 million combined image pixels, and 60 seconds for preflight. These are content-admission limits, not a Chromium process-memory cap. PNG output is additionally checked against the page bounds and a 16 MiB file cap. Keep these limits in step with [powerpointArchivePreflight.ts](../../src/electron/data/powerpointArchivePreflight.ts), [powerpointArchiveWorker.ts](../../src/electron/data/powerpointArchiveWorker.ts), and [powerpointRenderer.ts](../../src/electron/data/powerpointRenderer.ts).

## Evidence and status

Automated checks cover a real default `Main.IMPORT` through the app, retained source and PNG metadata, offline 4:3 and stock-SVG rendering, 36 full-HD image slides, archive and image limits, cancellation and recovery, process isolation, blocked external resources, and the worker/site/preload inside an ASAR. The combined unit suite passes 230 tests. These synthetic cases do not establish broad Office fidelity; package evidence and known gaps remain in the [portable renderer research note](../research/powerpoint-portable-renderer.md).

Local runtime checks use Linux Electron 37 / Chromium 138. The release workflow runs the production-built renderer and ASAR harness on Windows and macOS before each platform publishes, covering the runner’s native architecture. Other architectures, representative real-world decks, and physical output hardware still require qualification; the implementation is not claimed to be Office-equivalent.
