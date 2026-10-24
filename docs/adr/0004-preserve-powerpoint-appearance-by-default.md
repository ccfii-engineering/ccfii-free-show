---
status: accepted
implementation: pending
---

# Preserve PowerPoint appearance by default

PowerPoint imports will default to rendering the original deck into PDF pages or page images, preserving its appearance. Editable conversion remains available as an explicit Advanced choice with a warning that layout and content may change. This records the accepted target; implementation is pending.

Keep the managed original deck for rerendering and key cached pages by source, renderer, and resolution. Render one page at a time and keep nearby pages ready for display rather than decoding every high-resolution page at once. Fonts must be available when pages are rendered; rendered pages need no fonts at FreeShow display time. Static pages do not preserve motion, audio, or transitions, and reconstructing each slide from a screenshot is not equivalent to rendering the original deck.

When the default render path is unavailable, use the existing LibreOffice route or ask the user to author/export a PDF. Never silently switch to editable conversion. Do not add cloud conversion, a new rendering engine, or an engine installation flow.
