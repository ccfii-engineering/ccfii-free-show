# GPU Output Renderer Hardening Specification

**Status:** Approved

**Supersedes:** `2026-04-05-pixijs-webgpu-output-renderer-design.md`

## Problem Statement

After installing the latest FreeShow CCFII release, an operator can see duplicated presentation content when the GPU-accelerated output setting is enabled. Disabling that setting removes the duplication but returns the application to the Legacy Output Renderer, whose DOM-centered media composition consumes too much CPU for sustained presentation use.

The current implementation does not match its original design. The component called the WebGPU output currently forces a WebGL backend, wraps much of the Legacy Output Renderer, changes renderer selection for some media such as video, and has multiple partially overlapping initialization paths. This makes renderer ownership, failure recovery, transition lifetime, and backend status difficult to reason about. It also permits stale asynchronous work or retained visual generations to affect an otherwise current Presentation Output.

Operators need a GPU-first Presentation Output that behaves like native presentation software: one authoritative visible frame, GPU-accelerated media composition, deterministic transitions, bounded resource use, observable recovery, and correct behavior across physical and distributed targets.

## Solution

Give every Presentation Output one Output Coordinator that owns the complete visible frame and Renderer Session. The GPU Output Renderer is the default renderer and selects a true WebGPU backend first, then creates a fresh WebGL application if WebGPU cannot initialize and present a known probe frame. The Legacy Output Renderer remains available only as an atomic emergency fallback for an entire Renderer Session; GPU and legacy renderers must never participate in the same visible frame.

The Output Coordinator permits exactly one current Render Generation outside transitions. During a transition it may retain at most one outgoing Render Generation, which is destroyed on completion, cancellation, supersession, clearing, recovery, fallback, or shutdown. Every asynchronous media operation carries the Renderer Session identity and authoritative render revision, and may commit only while both remain current.

GPU composition covers media and the final presentation composition while existing DOM text remains temporarily for fidelity. Special browser or native Presentation Surfaces remain explicitly managed by the coordinator. Because these visible surfaces are not yet all represented inside GPU extraction, final-frame capture continues using the correctly composed Electron window until a later full-GPU migration.

Renderer health exposes session state (`initializing`, `gpu-active`, `recovering`, `legacy-fallback`, or `failed`), selected backend (`webgpu` or `webgl`), and fallback reason. Initialization, recovery, and fallback use the existing output lifecycle and circuit breaker rather than a competing retry loop.

## User Stories

1. As a presentation operator, I want each audience display to show one copy of the current slide, so that duplicated content never reaches the congregation.
2. As a presentation operator, I want GPU rendering enabled by default, so that normal operation does not require a high-CPU legacy mode.
3. As a presentation operator, I want video backgrounds to remain on the GPU renderer, so that playing a video does not silently switch the whole output to a slower renderer.
4. As a presentation operator, I want rapid slide changes to show only the newest selected slide, so that stale intermediate slides never flash onscreen.
5. As a presentation operator, I want interrupted transitions to resolve deterministically, so that outgoing content does not remain visible.
6. As a presentation operator, I want Clear and Restore to remove and restore the correct complete presentation state, so that emergency blanking is trustworthy.
7. As a presentation operator, I want slide text, fonts, line reveals, and formatting to remain visually compatible, so that existing shows do not need redesigning.
8. As a presentation operator, I want images and videos to preserve fit, cropping, filters, animation, and transition behavior, so that existing media cues remain correct.
9. As a presentation operator, I want overlays, underlays, effects, attribution, and drawing to retain their ordering, so that the composed frame matches the editor.
10. As a presentation operator, I want PDF, PowerPoint, websites, camera feeds, and captured windows to remain usable, so that GPU hardening does not remove supported presentation workflows.
11. As a presentation operator, I want transparent and blended outputs to remain correct, so that downstream keying and multi-projector layouts continue working.
12. As a presentation operator, I want multiple simultaneous Presentation Outputs to update independently and promptly, so that one display cannot contaminate or delay another.
13. As a presentation operator, I want the last valid frame held during brief recovery when safe, so that a transient renderer restart is less disruptive.
14. As a presentation operator, I want an unsafe or unavailable recovery state to show black rather than partial content, so that incomplete frames are never exposed.
15. As a presentation operator, I want a visible warning when automatic fallback occurs, so that I know performance and rendering behavior have degraded.
16. As a presentation operator, I want to see whether an output is using WebGPU, WebGL, recovering, or using emergency fallback, so that troubleshooting is based on facts.
17. As a presentation operator, I want a global emergency GPU-renderer control, so that I can recover the installation if a widespread driver problem occurs.
18. As a presentation operator, I want a per-output emergency control, so that one problematic display can fall back without penalizing healthy displays.
19. As an existing user, I want my saved renderer preferences to keep working after upgrade, so that the migration does not reset operational choices.
20. As a fresh-install user, I want the GPU Output Renderer enabled automatically, so that I receive the intended performance without configuration.
21. As an NDI operator, I want the distributed frame to match the physical Presentation Output, so that network viewers see the same composition.
22. As a Blackmagic operator, I want hardware output routing to retain the correct frame and lifecycle, so that production hardware remains dependable.
23. As a streaming operator, I want WebRTC, RTMP, and output-stream targets to receive the composed frame, so that GPU rendering does not omit text or overlays.
24. As a stage operator, I want Stage Monitors to keep their dashboard behavior, so that presentation-renderer changes do not alter operator tooling.
25. As a maintainer, I want one Output Coordinator to own renderer selection and visible generations, so that there is a single place to enforce invariants.
26. As a maintainer, I want backend initialization centralized, so that WebGPU and WebGL do not follow divergent setup paths.
27. As a maintainer, I want WebGPU initialization verified by a known presented frame, so that an initialized-but-blank backend is treated as failed.
28. As a maintainer, I want a failed WebGPU application destroyed before WebGL starts, so that partially initialized GPU resources cannot leak or overlap.
29. As a maintainer, I want renderer recovery coordinated with the existing Electron output lifecycle, so that nested retry loops cannot recreate windows repeatedly.
30. As a maintainer, I want repeated initialization failure to activate a bounded session fallback, so that the output remains usable without entering a restart loop.
31. As a maintainer, I want every asynchronous media commit guarded by session identity and revision, so that stale assets cannot become visible.
32. As a maintainer, I want textures, video elements, filters, animation frames, timers, and listeners to have explicit owners, so that long presentations have bounded resource use.
33. As a maintainer, I want shared cached media reference-counted, so that deduplication does not create premature disposal or leaks.
34. As a maintainer, I want renderer mode and backend reported separately, so that “GPU active through WebGL” is not confused with legacy rendering.
35. As a maintainer, I want the product language to say GPU Output Renderer rather than promise WebGPU specifically, so that terminology remains correct across backends.
36. As a maintainer, I want persisted setting keys retained for compatibility while APIs and UI adopt GPU terminology, so that cleanup does not break stored data.
37. As a maintainer, I want one reproducible browser-level duplication fixture, so that the original failure is caught at the highest practical seam.
38. As a maintainer, I want rapid-change, Clear/Restore, and interrupted-transition cases covered by the same fixture, so that related generation bugs cannot regress independently.
39. As a maintainer, I want a 100-change soak scenario with resource observations, so that lifecycle growth is detected before deployment.
40. As a release engineer, I want packaged smoke checks on supported desktop platforms, so that backend behavior is tested in Electron rather than inferred from unit tests.
41. As a release engineer, I want a precise hardware acceptance checklist for NDI, Blackmagic, multi-display, and multi-GPU configurations, so that unautomatable risks are explicit.
42. As a release engineer, I want performance measurements recorded per test machine, so that improvements are evidence-based without brittle universal CPU thresholds.

## Implementation Decisions

- A Presentation Output has exactly one Output Coordinator and one Renderer Session.
- The GPU Output Renderer is the default for physical outputs, invisible/capture outputs, NDI, Blackmagic, WebRTC, RTMP, and output-stream sources.
- Stage Monitors remain a separate DOM-rendered operator dashboard and do not enter the Presentation Output contract.
- Renderer mode and graphics backend are separate concepts. GPU mode may use either WebGPU or WebGL.
- Backend selection attempts WebGPU first. A backend is accepted only after a known-frame presentation probe succeeds.
- A failed or blank WebGPU application is completely destroyed before a new WebGL application is created.
- The Legacy Output Renderer is retained temporarily as an atomic Renderer Session fallback. It is never mounted as a participating surface inside a GPU-owned frame.
- A user opt-out starts the relevant output directly in legacy fallback. Automatic fallback is separately identified and includes its reason.
- Existing global and per-output persisted renderer keys remain readable and writable for compatibility. Product-facing terminology changes to GPU Output Renderer.
- Video and other supported media types do not change renderer mode. Content-specific routing happens inside the coordinator.
- Existing slide layout, fonts, media fit, cropping, filters, animations, transitions, overlays, effects, clear behavior, and control timing are compatibility requirements rather than opportunities for redesign.
- DOM text remains temporarily above or within the coordinator-managed composition to preserve fidelity. Moving all text into GPU textures is a separate migration.
- PDF, PowerPoint, website, camera, and native-window content use explicitly managed Presentation Surfaces where direct GPU textures are not yet safe.
- Electron composed-window capture remains authoritative while visible DOM/native surfaces exist. GPU-only pixel extraction must not replace it until it can represent the complete frame.
- Outside an active transition, exactly one current Render Generation may be visible. During a transition, exactly one current and at most one outgoing generation may exist.
- The newest authoritative presentation revision wins. Superseding input cancels the active transition and releases obsolete generations instead of queuing stale states.
- Asynchronous rendering and media loading carry Renderer Session identity and authoritative render revision. A mismatch prevents commit and releases the stale result.
- Generation-owned resources are released on transition completion, cancellation, supersession, clearing, recovery, fallback, and shutdown.
- Session-owned resources are released on recreation, fallback, or output closure. Shared media uses explicit reference ownership.
- Observable Renderer Session states are `initializing`, `gpu-active`, `recovering`, `legacy-fallback`, and `failed`. GPU-active sessions report `webgpu` or `webgl` separately.
- Renderer initialization has a named five-second deadline. Failure is reported to the existing Electron lifecycle, which performs one immediate bounded window recreation.
- Repeated failure within the existing 30-second circuit-breaker window starts the recreated output in legacy fallback for that session.
- Recovery holds the last successfully presented frame only when safe. Otherwise the output is black; partial initialization is never exposed.
- Obsolete debug components, bypassed initialization paths, and misleading coordinator-facing WebGPU-only names are removed after replacement behavior is covered.
- The April 2026 GPU renderer design is historical and superseded by this specification and the single-owner ADR.

## Testing Decisions

- Tests assert externally observable renderer behavior and lifecycle invariants, not Pixi implementation details.
- The primary seam is a browser-level Presentation Output fixture that exercises the real Output Coordinator with representative stores and content.
- The regression fixture renders the reported Welcome-slide scenario and fails if duplicate visible generations or duplicated composed content appear.
- The same fixture covers initial rendering, rapid slide changes, interrupted transitions, Clear, Restore, and output restart.
- DOM assertions prove one coordinator, one current generation outside transitions, at most one outgoing generation during a transition, and no outgoing generation after completion or cancellation.
- Screenshot comparison supplements structural assertions for the original duplication symptom and representative visual-parity cases.
- Focused pure tests cover backend selection, known-frame probe results, Renderer Session state transitions, revision/session commit guards, recovery escalation, and resource ownership.
- Existing output-state broker, client, publisher, routing, render-revision, presentation-state, transition, media-fit, background-animation, and video-control tests are prior art and remain part of the regression suite.
- Fake time verifies the five-second initialization deadline and integration with the existing 30-second recreation circuit breaker.
- A deterministic 100-change soak scenario records or asserts bounded counts for Render Generations, textures, video elements, filters, animation frames, timers, and listeners.
- Performance runs record frame cadence, dropped frames, backend, renderer state, CPU, and memory. CI enforces deterministic lifecycle invariants rather than universal machine-dependent CPU percentages.
- Target performance is stable 60 FPS at 1920×1080 for a representative video-background presentation and stable 30 FPS at 4K on qualified hardware.
- Production verification includes focused tests during development, regular Svelte type checks, the full test suite, a production build, and locally runnable packaged smoke tests.
- Release acceptance includes documented real-device checks for NDI, Blackmagic, multiple physical outputs, transparent output, display scaling, and multi-GPU topology where automation is unavailable.

## Out of Scope

- Rebuilding Stage Monitor dashboards with the GPU Output Renderer.
- Migrating all text layout and rasterization into GPU textures.
- Replacing composed-window capture with GPU-only extraction before every visible Presentation Surface is GPU-representable.
- Redesigning slide appearance, transitions, effects, or operator workflows.
- Removing the Legacy Output Renderer before GPU coverage and field stability justify a separate removal decision.
- Renaming persisted renderer setting keys in a destructive migration.
- Promising one universal CPU or memory percentage across different hardware and graphics drivers.
- Treating unavailable NDI or Blackmagic hardware as automatically verified by code inspection.

## Further Notes

- The confirmed operational workaround is disabling GPU-accelerated output rendering; this removes duplication but is not an acceptable permanent solution because it restores the high-CPU Legacy Output Renderer.
- Current history indicates WebGL was hardcoded while several initialization and canvas changes were made together. There is no isolated evidence that WebGPU itself caused the earlier blank output, so backend qualification must use the known-frame probe.
- The implementation should follow test-driven development at the approved seams and land as independently verified commits: coordinator invariants, backend initialization, content routing, recovery/health, resource hardening, and compatibility/soak verification.
