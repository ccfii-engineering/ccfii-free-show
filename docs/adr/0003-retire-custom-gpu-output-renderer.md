---
status: implemented
hardware_validation: pending
---

# Retire the custom GPU output renderer

The custom GPU output renderer and its renderer-specific settings and playback integrations have been removed. Video uses the ordinary Electron Presentation Output and its existing state synchronization, while normal Electron GPU acceleration remains enabled. This keeps playback ownership and recovery in the same output path as slides. Hardware validation across supported physical output configurations remains pending.

This supersedes the implementation decisions in ADR-0001 and ADR-0002; their original rationale remains as historical context.
