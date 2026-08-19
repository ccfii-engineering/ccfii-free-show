# FreeShow Presentation Output

This context describes how FreeShow turns presentation state into operator-visible and distributable output.

## Language

**Presentation Output**:
A rendered presentation intended for an audience-facing display or distribution target.
_Avoid_: Output window, screen output

**GPU Output Renderer**:
The presentation renderer whose media and final composition are GPU-accelerated, independently of whether its active graphics backend is WebGPU or WebGL.
_Avoid_: WebGPU renderer, Pixi output

**Legacy Output Renderer**:
The previous DOM-centered presentation renderer retained temporarily as an atomic session fallback.
_Avoid_: Old output, HTML output

**Output Coordinator**:
The single owner of a Presentation Output's visible frame and renderer lifecycle.
_Avoid_: WebGPU output component, output wrapper

**Render Generation**:
One immutable visual generation of presentation state. A transition may contain one current and at most one outgoing Render Generation.
_Avoid_: Old slide, render copy

**Presentation Surface**:
A visible content surface managed by the Output Coordinator, including GPU-composited media and explicitly supported browser or native content.
_Avoid_: Layer, renderer

**Distribution Target**:
A destination that receives a Presentation Output, such as a physical display, NDI, Blackmagic, WebRTC, RTMP, or an output stream.
_Avoid_: Capture type, network output

**Stage Monitor**:
An operator-facing dashboard derived from presentation state but not itself a Presentation Output.
_Avoid_: Stage output, prompter output

**Renderer Session**:
The lifetime of one renderer instance for a Presentation Output, including its recovery and fallback state.
_Avoid_: Window session, output run
