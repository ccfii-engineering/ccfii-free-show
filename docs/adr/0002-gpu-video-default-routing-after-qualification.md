# 0002 - GPU video becomes the default renderer after lifecycle qualification

Date: 2026-08-22

## Status

Accepted

## Context

The GPU (Pixi/WebGPU-or-WebGL) output renderer shipped with video backgrounds pinned to the
legacy DOM renderer (`special.gpuVideoLifecycleQualified` opt-in) because the external media
contract was not yet trustworthy: stale publishers survived media replacement, canonical
playback state drifted from what operators saw, failed sources caused retry storms, and
command round-trips raced the legacy audio engine.

Issues #15–#18 delivered that contract behind the opt-in flag: canonical per-output playback
state (#16), command and loop parity (#17), and lifecycle-safe replacement, cleanup, and
failure recovery (#18).

## Decision

1. GPU video routing is now the **default** once `config/testing/gpu-video-qualification.test.ts`
   passes. The suite drives the real Electron seam — operator selection, Presentation Output,
   controls, and public REST reads — across every format family the bundled Chromium runtime
   decodes in CI (WebM VP9/VP8, MP4 H.264, MKV H.264, MOV H.264), and writes a machine-readable
   result to `test-output/gpu-video-qualification.json`.
2. The qualification result is distinct from graphics-backend initialization: a successful
   canvas says nothing about media behavior, so the suite asserts the media contract explicitly
   and fails routing eligibility independently of backend health.
3. Safe fallbacks remain in force and are part of qualification:
   - `useWebGPUOutput === false` or per-output `useWebGPU === false` → legacy renderer.
   - Session-level GPU failure → atomic legacy fallback (existing circuit breaker).
   - Bounded/custom loop semantics (`startAt`, `softLoop`) → legacy renderer; never silently
     reinterpreted on GPU.
   - Player backgrounds (live streams) → legacy path.
   - Unsupported/undecodable sources → one bounded failure outcome per source, no phantom
     state, no retry storm.
4. An explicit `gpuVideoLifecycleQualified: false` opt-out keeps video backgrounds on the
   legacy renderer for operators who need the old behavior.

## Consequences

- Fresh installs present video through the GPU renderer by default.
- Any regression in the external media contract is caught by the qualification suite before it
  can silently ride on a healthy canvas.
- The temporary launch flag `--gpu-video-lifecycle-qualified` remains parsed but is no longer
  required to exercise GPU video; the meaningful switch is now the opt-out.

Refs #14, #15, #16, #17, #18, #19
