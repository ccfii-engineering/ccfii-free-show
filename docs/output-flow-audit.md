# Output Flow Audit

Date: 2026-07-26

## Scope and ground truths

This audit follows every path that can affect a presentation output. A flow is considered authoritative only when its source, routing identity, current state, and consumer behavior are observable in code. Timing delays and arrival order are not treated as synchronization.

- The main renderer's Svelte stores own presentation-domain state.
- Electron owns output-window identity, delivery, retries, and lifecycle.
- Each output renderer owns applied/rendered observations for its current session.
- Hardware/network/capture sample producers own transient frame or sample data; these streams are intentionally not converted into durable state.

## Flow inventory and result

| Flow | Source of truth | Route and consumer | Evidence / protection | Result |
| --- | --- | --- | --- | --- |
| Per-output presentation and configuration | `outputs[id]` | `OutputStatePublisher` → authenticated Electron broker → matching output session → `outputs` store | Full output-scoped snapshots, monotonic revision/hash, exact output ID, retry and APPLIED acknowledgement; broker/client/publisher/routing tests | Hardened |
| Shared render dependencies | Actual stores listed in `OUTPUT_STATE_TOPIC_SOURCES` | Shared snapshots → broker cache → every ready output session | Exhaustive topic list and adapter switch; output snapshots carry the exact dependency revision vector and wait at the client gate; snapshot/publisher/client tests | Hardened |
| Output startup and recreation | Broker's latest validated cache | Renderer READY → manifest → full APPLY set → APPLIED | Session IDs prevent acknowledgements from an old window satisfying a new window; missing state is requested explicitly; no fixed initialization delay for real outputs; broker/client tests | Hardened |
| Delivery failure and recovery | Broker delivery ledger | 500 ms, 1 s, and 2 s full-snapshot retry → one bounded recreation → circuit breaker | Exact revision/hash acknowledgement, supersession by newer state, 30 s recreation limit, operator health events; broker tests | Hardened |
| Clear All | One atomic `outputs.update` over active presentation outputs | `clearAll()` → output snapshot → DOM/WebGPU consumers | Explicit `presentationMode: "cleared"`; removes slide, explicit background, overlays including locked overlays, effects and transitions; clears video/time tracking, slide/overlay timers, audio/metronome, credits and presentation control; presentation-state tests | Hardened |
| Restore / resume live | Cached pre-clear `OutData`, or a new non-null slide/background action | Atomic output-store update and new snapshot | Restore and new slide/background set `live` in the same mutation; overlay-only/timer-only actions cannot accidentally unblank a cleared output; presentation-state tests | Hardened |
| DOM output layers | Authoritative output mode plus output/dependency stores | `Output.svelte` | Cleared mode suppresses explicit/style/template background, solid style color, slide, overlays, effects, colorbars, attribution and drawing | Hardened |
| WebGPU/Pixi layers | Authoritative output mode plus current render generation | `WebGPUOutput.svelte` → both Pixi slots | Clear increments/cancels pending work, animations and debounced timers, synchronously nulls both slots, and rejects late older commits; render-revision tests | Hardened |
| Output window lifecycle | Electron `OutputHelper` output registry | create/remove/close/recreate helpers | Broker registration binds output ID to `webContents`; removal also removes stale capture/stage routing; lifecycle route traced and routing-collection tests | Hardened |
| Visibility, bounds and identify | Electron output registry and display configuration | specialized `OutputVisibility`, `OutputBounds`, `OutputIdentify` helpers | Remains Electron-owned and outside render-state replication; no inferred renderer identity | Audited; unchanged |
| Multi-output targeting | Registered output IDs | direct `Message.id`, broker output scope, NDI/Blackmagic route collections | Direct messages can only reach the matching ID; safe collection removal prevents `splice(-1)` from deleting an unrelated route; routing tests | Hardened |
| Thumbnail/offscreen output | Authenticated requesting output window | targeted `REQUEST_DATA_MAIN` reply → legacy thumbnail renderer | Electron stamps the requesting output ID and every initialization message is direct-targeted; removed delayed resend | Hardened compatibility path |
| Video/player durable baseline | `videosData`, video time/tracking stores and `mediaControlBaseline` | Reliable state snapshot, followed by low-latency controls | New sessions receive the current baseline; Clear All removes video data/time/tracking; existing video control/loop tests plus presentation tests | Hardened state; stream remains transient by design |
| Audio/metronome durable baseline | volume, gain, channels, equalizer, playing audio, metronome stores | Reliable shared topics | Full current values initialize/recover renderers; Clear All invokes existing audio and metronome shutdown exactly once | Hardened state |
| Audio/time/dynamic/visualizer samples | Their live producer clocks/buffers | Dedicated `AUDIO_DATA`, `TIME`, `DYNAMIC_VALUE_DATA`, `VISUALIZER_DATA`, `BUFFER` channels | Kept separate from durable replication to avoid broker backpressure; new sessions obtain durable baselines before consuming samples | Audited; unchanged transient streams |
| Preview and capture | Current output renderer/capture producer | capture buffer → Electron `CaptureTransmitter` → preview/stage/hardware targets | Output deletion now removes stale stage-window capture membership; capture remains frame-based and deliberately lossy | Hardened lifecycle; unchanged frame transport |
| Stage mirror | Main `outputs` store and stage configuration | retained `ALL_OUTPUTS` mirror plus capture routes | Deliberately retained because it is a separate consumer, not an output-renderer state initializer | Audited; unchanged |
| NDI sender/capture | Capture transmitter and selected output IDs | frame route to NDI sender | Safe target removal prevents unrelated routing loss; state initialization is handled before capture starts | Hardened routing |
| NDI receiver | Electron receiver registry | NDI receiver frame source → selected consumers | Missing/stale receivers are guarded; safe target removal used | Hardened routing |
| Blackmagic sender/capture | Capture transmitter and selected output IDs | frame route to Blackmagic sender | Safe target removal prevents unrelated routing loss | Hardened routing |
| Blackmagic receiver | Electron receiver registry | Blackmagic receiver frame source → selected consumers | Missing receiver access is guarded; safe target removal used | Hardened routing |
| Remote, controller and output stream | Server-specific stores/sockets | Their server IPC/WebSocket paths | They do not initialize Electron output renderers; `output_stream` consumes its own audio/video stream. No durable output-state channel was removed from them | Boundary audited; unchanged |
| Render health | Output renderer's terminal observation | `RENDERED`/`REJECTED` → broker → operator health store/toast | Clear is reported rendered only after the blank state applies; delivery and render failures are distinct so bad media cannot trigger a window-recreation loop; render tracker tests | Clear terminal path hardened; general live-media terminal adapters remain a separate observability improvement |

## Durable topic coverage

The reliable protocol covers output state and all shared stores previously used to initialize rendering: language, styles, transitions, shows, categories, templates, overlays, events, groups, drawing and tools/settings, media metadata, slide cache, effects, timers, variables, time formatting, special settings, slide timeline speed, player videos, stage/projects/show data, metadata/credits, volume/gain/channels/equalizer, metronome state, playing audio, colorbars, live preparation, and the media-control baseline.

Legacy durable broadcasts for these topics were removed. `ALL_OUTPUTS` and high-frequency frame/sample/control channels remain only where their separate consumers or low-latency semantics require them.

## Verification boundary

Automated verification covers protocol validation, authoritative topic mapping, routing authentication, dependency ordering, retries/recovery, stale message rejection, Clear/Restore behavior, render-generation cancellation, and safe downstream target removal. The production compile covers the main frontend, remote, stage, controller, output-stream server, and Electron main process.

Hardware presentation devices (physical NDI and Blackmagic endpoints), OS display topology, and operator-visible media playback still require real-device acceptance testing; code inspection and deterministic routing tests cannot truthfully substitute for those environments.
