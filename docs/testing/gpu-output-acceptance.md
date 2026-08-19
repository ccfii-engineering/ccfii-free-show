# GPU Output Renderer acceptance

Use this checklist on every release candidate that changes the Presentation Output. Automated checks enforce renderer ownership, backend qualification, recovery, media routing, and bounded resource lifetimes. Hardware-dependent behavior must be recorded on real systems.

## Automated gate

Run from the repository root:

```bash
npm test
npm run build
npm run pack
```

The Electron test creates a real Presentation Output and requires exactly one Output Coordinator and one canvas whose `data-gpu-backend` is `webgpu` or `webgl`. It also sends rapid slide changes and rechecks those invariants. The unit suite includes a 100-change Render Generation soak and a 100-resource acquire/release soak.

## Packaged smoke test

For each supported desktop platform, launch the artifact produced by `npm run pack` with a fresh settings directory and record:

- OS, architecture, Electron version, GPU model, driver version, display topology, and scaling.
- Renderer status shown in Output settings. Prefer `WebGPU active`; `WebGL compatibility active` is acceptable only with a recorded reason. `Legacy fallback active` blocks release for the tested machine until triaged.
- A Welcome slide, a text-heavy song, one image background, one H.264 video background, and one live/native Presentation Surface.
- Rapidly select 100 slides, interrupt at least five transitions, then Clear and Restore. Confirm one visible composition, the newest slide wins, and no outgoing image remains.
- Close and reopen the output twice. Confirm no restart loop and that recovery/fallback notifications match the displayed renderer status.

## Performance record

Measure a five-minute 1920×1080 video-background presentation and, where hardware supports it, a five-minute 4K presentation. Record values rather than applying a universal CPU threshold.

| Machine | Resolution | Backend | Average FPS | Dropped frames | App CPU | GPU use | RSS start/end | Notes |
| ------- | ---------- | ------- | ----------: | -------------: | ------: | ------: | ------------- | ----- |
|         |            |         |             |                |         |         |               |       |

Targets are stable 60 FPS at 1920×1080 and stable 30 FPS at 4K on qualified hardware. CPU should remain materially below the same fixture using emergency Legacy Output Renderer mode.

## Hardware and distribution matrix

Record pass, fail, or not available for each applicable row:

| Check                                | Windows | macOS | Linux | Evidence |
| ------------------------------------ | ------- | ----- | ----- | -------- |
| One and two physical outputs         |         |       |       |          |
| Mixed display scaling                |         |       |       |          |
| Integrated/discrete multi-GPU        |         |       |       |          |
| Transparent/key output               |         |       |       |          |
| Edge blending                        |         |       |       |          |
| NDI composition matches window       |         |       |       |          |
| Blackmagic composition and lifecycle |         |       |       |          |
| WebRTC and RTMP composition          |         |       |       |          |
| Output-stream and Stage clients      |         |       |       |          |
| PDF and PowerPoint                   |         |       |       |          |
| Website, camera, and captured window |         |       |       |          |

Electron composed-window capture is authoritative while DOM text and live/native surfaces remain in the composition. Do not substitute Pixi-only extraction for NDI, Blackmagic, WebRTC, RTMP, preview, or output-stream acceptance.
