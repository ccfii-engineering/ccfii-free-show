# Presentation Output acceptance

Use this checklist for releases that change Presentation Output. Automated checks cover the ordinary DOM renderer, durable output-state delivery, media playback, and operator controls. Hardware-specific routes still need checks on real systems.

## Automated gate

Run from the repository root:

```bash
npm run test:unit
npx playwright test --config config/testing/playwright.config.ts
npm run test:svelte
npm run build
```

The Electron suites create a real Presentation Output and verify text and media render through the DOM path, image and video backgrounds appear, supported video formats report advancing playback state, operator controls pause/seek/mute/loop correctly, mirrored previews follow playback, and Clear/Restore and output reopen work. Unit suites cover output-state ordering, dependency matching, retries, bounded recreation, playback ownership, animation styles, and transition timing.

## Packaged smoke test

For each supported desktop platform, launch the artifact produced by the packaging build with a fresh settings directory and record:

- OS, architecture, Electron version, display topology, and scaling.
- A text-heavy song, one image background, one H.264 video background, one animated slide, and one live or native Presentation Surface.
- Rapidly select 100 slides, interrupt several transitions, then Clear and Restore. Confirm the newest slide wins and outgoing media is removed.
- Pause, resume, seek, mute, and loop video. Confirm the operator controls, output, preview, and public playback readouts agree.
- Close and reopen the output twice. Confirm output state recovers without duplicate content.
- Confirm the existing Electron hardware acceleration setting remains enabled as configured.

## Performance record

Measure a five-minute 1920×1080 video-background presentation and, where hardware supports it, a five-minute 4K presentation. Record values for comparison without applying a universal CPU threshold.

| Machine | Resolution | Average FPS | Dropped frames | App CPU | GPU use | RSS start/end | Notes |
| ------- | ---------- | ----------: | -------------: | ------: | ------: | ------------- | ----- |
|         |            |             |                |         |         |               |       |

## Hardware and distribution matrix

Record pass, fail, or not available for each applicable row:

| Check                                | Windows | macOS | Linux | Evidence |
| ------------------------------------ | ------- | ----- | ----- | -------- |
| One and two physical outputs         |         |       |       |          |
| Mixed display scaling                |         |       |       |          |
| Transparent/key output               |         |       |       |          |
| Edge blending                        |         |       |       |          |
| NDI composition matches window       |         |       |       |          |
| Blackmagic composition and lifecycle |         |       |       |          |
| WebRTC and RTMP composition          |         |       |       |          |
| Output-stream and Stage clients      |         |       |       |          |
| PDF and PowerPoint                   |         |       |       |          |
| Website, camera, and captured window |         |       |       |          |

Electron composed-window capture remains authoritative while DOM text and live/native surfaces appear in the output.
