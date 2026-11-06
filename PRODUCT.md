# Product context

## FreeShow

FreeShow is an open-source presentation application for displaying song lyrics, media, and slideshows on venue screens. Its operator surfaces serve churches and other live presentation settings. The product uses Electron, Svelte 3, and TypeScript; server applications provide remote access and stage/control views.

## Remote and Controller operator context

This context is for the browser-based Remote and Controller apps. An operator uses a phone, tablet, or desktop while a presentation is live, often in a dim room and under time pressure. They need to identify what is currently on screen, what comes next, and which action will affect the output. Remote also supports browsing media, preparing a selected item, and deliberately sending it to the output.

The Remote phone surface includes show/project selection, media, scripture, and presentation controls. Its tablet surface keeps a multi-pane workspace and dockable drawer. The Controller surface shows current/next previews and notes, advances or clears output, and supports draw tools.

This UI modernization changes the Remote media journey and Controller presentation surface. Tablet changes connect the media preview to the existing workspace; the tablet shell takes the operator colour palette but retains its existing layout and workflows (layout follow-up: issue #53), and other Remote destinations retain their existing workflows. Auth behavior remains unchanged. The desktop presentation interface, Stage, Camera, and authored slide themes have their own product and visual authority.

## Product constraints

- Preserve current workflows, show/output state, existing socket channels, and approved authorization paths.
- Media launch is an explicit operator action. Browsing or selecting a row does not send content live.
- Keep Next action semantics when a next-slide preview is absent; the preview does not determine whether advancing can act. Disable only while offline or when an existing explicit state makes the action unavailable.
- Guard live click, keyboard, and draw sends while disconnected so Socket.IO does not buffer an action and replay it after reconnect.
- Keep Clear one tap; do not add a confirmation step.
- Preserve draw-mode behavior and media playback controls.
- Do not redesign authentication, server behavior, PowerPoint rendering, or thumbnail/resource limits as part of this UI pass.
- Preserve the CCFII emblem and the confirmed crimson and amber identity colors.

This document records product behavior and scope. See [`DESIGN.md`](DESIGN.md) for the visual system of the modernized Remote media and Controller surfaces.
