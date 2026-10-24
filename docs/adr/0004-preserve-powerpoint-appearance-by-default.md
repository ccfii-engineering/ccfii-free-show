---
status: accepted
implementation: complete
platform_validation: pending
---

# Preserve PowerPoint appearance by default

PowerPoint imports default to static rendered slide images, preserving appearance. Editable conversion remains an explicit choice with a warning that layout and content may change. The current path converts PowerPoint to a managed PDF with LibreOffice, then renders pages sequentially with PDF.js and stores PNGs and import metadata in the app data folder. PDF files use the same PDF.js renderer.

Keep managed source files and key reusable pages by source hash, renderer version, and resolution. Render one page at a time, fitted within 1920 × 1080 and capped at 2,073,600 pixels per page. Fonts must be available when pages are rendered; rendered pages need no fonts at FreeShow display time. Static pages do not preserve motion, audio, or transitions, and reconstructing each slide from a screenshot is not equivalent to rendering the original deck. A backend rerender helper exists but has no UI caller yet.

If LibreOffice is unavailable, offer the user a PDF export/import route. Never silently switch to editable conversion. Do not add cloud conversion, a new rendering engine, or an engine installation flow.

Real LibreOffice conversion, including Windows, and manual output/hardware validation remain pending. Implementation status does not mean the feature has been released.
