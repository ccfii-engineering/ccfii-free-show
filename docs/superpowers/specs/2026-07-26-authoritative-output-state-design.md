# Authoritative Output State Design

## Goal

Make every presentation output converge on the latest authoritative render state, including its output configuration and shared rendering dependencies, during startup, rapid updates, Clear All, renderer stalls, and output-window recreation. Clear All must blank every visual and audible output layer and remain authoritative until Restore or new live slide/background content is sent.

## Scope

This design covers every stateful main-to-output topic used to render an output: the per-output presentation/configuration state plus shared styles, transitions, shows, categories, templates, overlays, events, groups, drawing state, media metadata, effects, timers, variables, special settings, player/stage data, dynamic-value inputs, and other initialization stores. It includes topic snapshots, dependencies, ordering, validation, readiness, acknowledgements, resynchronization, bounded recovery, and health reporting.

It does not turn high-frequency media-control samples (`TIME`, audio samples, preview buffers) into durable events, redesign remote/stage network protocols, or persist transient live output state across full application restarts. Those streams retain their low-latency channels; the renderer obtains their current baseline through a reliable state topic during handshake and then consumes newer samples by timestamp/sequence.

## Output Reliability Program

The complete output audit is divided into independently testable workstreams so findings are demonstrated rather than mixed into one speculative rewrite:

1. Authoritative state replication and Clear All correctness (this design).
2. DOM/WebGPU rendering parity, layer lifecycle, transitions, and asynchronous media cancellation.
3. Output-window lifecycle, visibility, bounds, restart, multi-output routing, and health recovery.
4. Video/audio control, clocks, end-of-media behavior, and state-baseline recovery.
5. Preview/capture, stage output, NDI, and Blackmagic handoffs.

Each later workstream begins with a flow inventory, instrumentation or a failing test, and a separate focused design/plan when its findings require behavioral or architectural changes. “No issue found” is a valid audited result; production code changes require evidence of an incorrect contract or behavior.

## Ground Truth Model

Ground truth is explicit at each boundary:

1. The main renderer owns domain truth. Each source Svelte store is the only producer for its corresponding reliable topic; the output publisher is the only component allowed to assign that topic's revisions.
2. Electron main owns delivery truth. It validates and caches the latest accepted snapshot for every shared topic and every output-scoped topic, then records which renderer session has acknowledged each revision.
3. Each output renderer owns applied and rendered truth. It accepts only snapshots for its registered output and current protocol, rejects stale revisions, applies topic snapshots atomically, and separately reports the exact revision/hash that reached the target store and the output revision/hash that reached a terminal rendered or render-failed state.

No process infers synchronization from elapsed time, absent fields, local fallback state, or the order in which asynchronous media finishes loading.

## Authoritative Topics and Snapshots

Every stateful channel is represented by a typed topic. Shared topics are cached once and delivered to every output; output topics are scoped to one output. Each delivered snapshot has a typed envelope:

```ts
export const OUTPUT_STATE_PROTOCOL_VERSION = 1

export type OutputPresentationMode = "live" | "cleared"
export type OutputStateScope = { kind: "shared" } | { kind: "output"; outputId: string }
export type OutputStateTopic = "output" | "language" | "styles" | "transition" | "shows" | "categories" | "templates" | "overlays" | "events" | "groups" | "draw" | "drawTool" | "drawSettings" | "media" | "outputSlideCache" | "effects" | "timers" | "activeTimers" | "variables" | "timeFormat" | "special" | "slideTimelineSpeedMultiplier" | "playerVideos" | "stage" | "projects" | "activeProject" | "showsData" | "customMetadata" | "customCredits" | "volume" | "gain" | "audioChannelsData" | "equalizerConfig" | "metronome" | "metronomeTimer" | "playingAudio" | "colorbars" | "livePrepare" | "mediaControlBaseline"

export interface OutputTopicSnapshot<T extends OutputStateTopic = OutputStateTopic> {
    protocolVersion: typeof OUTPUT_STATE_PROTOCOL_VERSION
    topic: T
    scope: OutputStateScope
    revision: number
    contentHash: string
    payload: OutputStatePayloadByTopic[T]
}
```

`revision` is monotonic per topic/scope key within the lifetime of the main renderer. `contentHash` is computed from canonical serialization of the topic, scope, revision, and payload; it detects payload corruption or accidental revision reuse. Every topic snapshot is a full replacement, never a delta.

The `output` topic payload contains the complete output entry required by `MainOutput.svelte`, including configuration and transient presentation state. Its `out.presentationMode` is mandatory in published snapshots. Existing saved output configuration remains separate because loading settings removes `out` as it does today.

In `cleared` mode, output renderers suppress all presentation content even if style, template, cached media, or asynchronous loaders still contain data. The authoritative `out` payload is also normalized to contain no slide, explicit background, effects, overlays, or transition. This gives defense in depth: the data is cleared at the source and the renderer enforces the explicit mode.

When Restore is invoked, the cached pre-clear `OutData` becomes a new `live` snapshot with a new revision. Sending a non-null slide or background live also changes the affected output to `live` in the same atomic state update. Overlay-only and timer-only actions do not implicitly leave `cleared` mode.

## Protocol

The reliable state channel uses these typed messages:

- `OUTPUT_STATE_PUBLISH`: main renderer → Electron. Carries one complete topic snapshot.
- `OUTPUT_STATE_READY`: output renderer → Electron. Carries `outputId`, a new renderer `sessionId`, and supported protocol version.
- `OUTPUT_STATE_MANIFEST`: Electron → one output renderer. Carries the target `sessionId` and exact latest topic/scope/revision/hash entries the renderer must converge on.
- `OUTPUT_STATE_APPLY`: Electron → one output renderer. Carries one cached topic snapshot and target `sessionId`.
- `OUTPUT_STATE_APPLIED`: output renderer → Electron. Carries `outputId`, `sessionId`, topic, scope, revision, and `contentHash` after atomic target-store application and a Svelte tick.
- `OUTPUT_STATE_RENDERED`: output renderer → Electron. Carries the same identity after every required layer has either committed its visual state or reported a typed render failure.
- `OUTPUT_STATE_REJECTED`: output renderer → Electron. Carries the same identity fields and a typed rejection reason such as unsupported protocol, invalid snapshot, wrong output, stale revision, or hash mismatch.
- `OUTPUT_STATE_NEEDED`: Electron → main renderer. Requests exact missing topic/scope keys when an output becomes ready before Electron has a complete cache.
- `OUTPUT_STATE_HEALTH`: Electron → main renderer. Carries observed delivery state for operator-facing status.

Electron obtains the output identity from the sender's registered `webContents`, not solely from untrusted payload data. It forwards a snapshot only to the matching output window.

## Data Flow

### Normal update

1. A domain action updates its source store in the main renderer.
2. The topic publisher assigns the next revision, creates the canonical full snapshot from that store's actual value, computes its hash, and sends it to Electron. Before publishing an `output` topic, it synchronously samples and publishes any changed dependency stores, then records those observed revisions in the output dependency vector; it never assumes earlier subscription callbacks have run.
3. Electron validates topic, scope, protocol version, revision, payload, and hash before replacing the corresponding cache entry.
4. Electron sends the snapshot to every current renderer session that consumes that shared topic, or only to the matching renderer for an output-scoped topic.
5. The renderer validates the snapshot, ignores revisions older than or equal to its last applied revision for that topic/scope, replaces the mapped local store atomically, waits for the next Svelte update tick, and acknowledges the exact topic/revision/hash.
6. An output snapshot includes a dependency vector naming the exact shared-topic revisions used by the main renderer when it created that snapshot. The output renderer does not expose that output revision to rendering until all dependency revisions are applied; missing dependencies are requested explicitly.
7. DOM and Pixi layer adapters report completion or a typed media/render failure for that output revision. The renderer sends `OUTPUT_STATE_RENDERED` only after every required layer reaches one of those terminal states.
8. Electron marks a topic synchronized only when APPLIED matches its latest cached topic/scope/revision/hash and current session. It records rendered health separately so a missing/corrupt media file is not mistaken for a dead renderer.

### Startup and recreation

The output renderer registers its receiver first, generates a new session ID, and sends `OUTPUT_STATE_READY`. Electron constructs a manifest from its cache and immediately sends the complete set of latest topic snapshots required by that output. If any required topic is absent, Electron sends `OUTPUT_STATE_NEEDED` to the main renderer and completes the manifest only after the publisher supplies the actual current store values. This replaces the existing fixed startup waits, delayed initial sends, and comments that rely on one store being sent before another.

An acknowledgement from a previous renderer session cannot satisfy the new session. A recreated window therefore always begins from Electron's cached latest full snapshot.

### Clear All

Clear All performs one atomic update per active output:

- `mode` becomes `cleared`;
- slide and explicit background become `null`;
- overlays and effects become empty arrays, except that the existing locked-overlay policy is removed for Clear All because “all” is authoritative;
- slide/overlay timers and video tracking are stopped and cleared;
- audio and metronome cleanup remains coordinated by the main renderer;
- the resulting state is published once with one new revision per affected output.

The renderer checks `mode` before resolving template or style fallbacks. It also invalidates pending media render requests when applying a `cleared` snapshot. Consequently a slow image/video load from an older revision cannot reappear.

## Reliability and Recovery

Electron tracks delivery per output session and topic/scope key: latest revision/hash, applied acknowledgement, retry count, and last observed timestamp. Rendered results are tracked per output revision.

- If a manifest topic revision is not acknowledged within 500 ms, Electron resends that latest full topic snapshot.
- Electron retries at 500 ms, 1 second, and 2 seconds. A newer published revision supersedes the retry schedule immediately.
- After three missed acknowledgements, Electron marks the output unhealthy, reports that observed fact to the main renderer, and recreates the output window once.
- Recreated windows must complete a fresh READY/APPLY/APPLIED handshake.
- A circuit breaker permits at most one automatic recreation for an output within 30 seconds. If the recreated renderer still fails, Electron leaves it unhealthy and shows an operator warning instead of looping.
- A later valid acknowledgement returns the output to healthy status.
- Render completion has a separate media-aware deadline. A typed render failure or deadline expiry is reported to the operator with the affected layer and revision, but does not recreate a responsive renderer. A newer snapshot cancels the older render deadline.

Retries always resend the full latest topic snapshot. No retry replays superseded state.

## Validation and Error Handling

All protocol messages use runtime type guards in addition to TypeScript types. Invalid messages are rejected without mutating cached or rendered state.

Electron rejects:

- unknown topics, scopes, output IDs, or sender/output identity mismatches;
- unsupported protocol versions;
- non-integer, non-positive, or non-monotonic revisions;
- malformed topic payloads or output dependency vectors;
- content hashes that do not match canonical payload serialization.

Output renderers reject wrong-output, wrong-session, unsupported, malformed, or hash-mismatched snapshots. Stale snapshots are acknowledged as stale observations but are never applied.

Diagnostic logs contain output ID, renderer session, revision, message type, retry count, and typed reason. They do not log full show content or local media paths.

## Compatibility and Migration

The new state protocol first wraps the stores currently listed in `initalOutputData`, the other durable stores already sent by `storeSubscriber()` (`outputSlideCache`, `activeTimers`, gain/channel/equalizer/metronome state, playing-audio paths, colorbars, and live-prepare state), plus per-output state and the current media-control baseline. Existing channel handlers remain as temporary adapters while each topic moves to the reliable client. Once all output-renderer consumers use topic snapshots, redundant stateful sends (`OUTPUTS`, `STYLES`, `SHOWS`, and peers) are removed. `ALL_OUTPUTS` remains only for the stage-mirror use case until that consumer is migrated deliberately.

Sample streams (`BUFFER`, `TIME`, `AUDIO_DATA`, `DYNAMIC_VALUE_DATA`, and `VISUALIZER_DATA`) keep dedicated channels with monotonic sample sequence/timestamp checks. Their latest meaningful baseline is included in a reliable topic when a new renderer session needs one; old samples are discarded by observed sequence, not arrival timing.

The existing `getOutputReceiverSignature` optimization must not control authoritative snapshot application. Topic, scope, revision, and hash are the only synchronization identity.

Transient presentation snapshots and broker revisions are not written to saved settings. On a full app restart, outputs begin from the normal empty live state established by startup settings.

## Components

- `src/types/OutputState.ts`: topic map, protocol envelopes, presentation mode, dependency vectors, health, rejection reasons, and runtime guards.
- Main-renderer publisher: maps authoritative stores to reliable topics and creates canonical full snapshots/revisions from actual store values.
- Electron output-state broker: validates, caches, manifests, routes, retries, tracks sessions/acknowledgements, and invokes bounded recreation.
- Output-renderer client: READY/manifest handshake, topic-to-store adapters, dependency gating, validation, stale rejection, atomic application, and APPLIED acknowledgement.
- Output rendering resolver: derives visible style/template/explicit background from authoritative presentation mode and invalidates old asynchronous render work on clear.

Each component has a narrow interface and can be tested without opening Electron windows.

## Testing

### Unit tests

- Canonical hashing is stable for equivalent topic snapshots and changes for every payload mutation.
- Runtime guards reject malformed versions, topics, scopes, IDs, revisions, modes, dependency vectors, payloads, and hashes.
- Broker accepts only increasing per-topic revisions, routes shared/output scopes correctly, and never replaces truth with invalid/stale data.
- READY produces a complete manifest and sends the latest cached snapshot for every required topic to the current session.
- An output revision is not rendered until every dependency-vector revision is applied.
- APPLIED and RENDERED only satisfy the exact current session/revision/hash, and they update independent delivery/render health.
- Retry scheduling resends only the latest snapshot and observes the 500 ms/1 s/2 s limits.
- Circuit breaker allows one recreation per 30 seconds and reports unhealthy state after repeated failure.
- A cleared presentation resolves no explicit, template, or style background.
- An older asynchronous media request cannot commit after a cleared or newer revision.
- Restore and new slide/background actions leave cleared mode atomically; overlay-only actions do not.

### Integration tests

- Rapid slide → background → Clear All delivery with reordered asynchronous media completion ends blank on both DOM and Pixi render paths.
- Output startup and recreation converge on the latest broker snapshot without timing sleeps.
- A dropped apply message is recovered by retry.
- A stale acknowledgement does not mark a newer revision synchronized.
- A responsive renderer with a missing media file reports render failure without entering a window-recreation loop.
- Multi-output updates preserve independent output revisions, modes, sessions, and health while sharing exact acknowledged dependency revisions.

### Verification

Run focused Node tests, Svelte type checking, frontend/Electron linting, formatting checks, and the production build. Manually verify Clear All, Restore, rapid slide/media changes, output toggling, and forced output-window recreation with both WebGPU enabled and disabled.

## Success Criteria

- Clear All always produces a completely blank active output and remains blank until Restore or new live slide/background content.
- No stale snapshot or late media load can overwrite a newer revision.
- Output startup and recovery use observed readiness and acknowledgements, not fixed delays.
- The operator can distinguish synchronized, retrying, recovering, and unhealthy output states.
- Every stateful output-renderer decision can be traced to a validated authoritative topic snapshot or an observed protocol event.
