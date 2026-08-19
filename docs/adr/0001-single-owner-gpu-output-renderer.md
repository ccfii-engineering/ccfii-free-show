---
status: accepted
---

# Use one GPU-first owner for each presentation output

Each Presentation Output has one Output Coordinator that owns the complete visible frame. The GPU Output Renderer is the default across physical and distribution targets; it may use WebGPU or WebGL as its graphics backend. The Legacy Output Renderer may replace the complete renderer only after bounded recovery fails, and it must never be mixed into the same visible frame. This prevents independently retained render generations, makes failure behavior observable, and preserves an emergency path while GPU coverage is completed.

## Consequences

Transitions may retain one outgoing Render Generation alongside the current generation, but the coordinator must destroy it on completion, cancellation, or supersession. Stage Monitors remain outside this contract. Browser/native Presentation Surfaces for special content remain coordinator-managed until they can move into GPU composition.
