# Authoritative Output State Design

## Goal

Make every presentation output converge on the latest authoritative state, including during startup, rapid updates, Clear All, renderer stalls, and output-window recreation. Clear All must blank every visual and audible output layer and remain authoritative until Restore or new live slide/background content is sent.

## Scope

This design covers the presentation-output state path from the main Svelte renderer through Electron main to each output renderer. It includes output snapshots, ordering, validation, readiness, acknowledgements, resynchronization, bounded recovery, and health reporting.

It does not replace the independent high-frequency media-control channels (`TIME`, `DATA`, audio samples, preview buffers), redesign remote/stage protocols, or persist transient live output state across full application restarts.

## Ground Truth Model

Ground truth is explicit at each boundary:

1. The main renderer owns domain truth. Its `outputs` store is the only process allowed to create a new presentation snapshot or revision.
2. Electron main owns delivery truth. It validates and caches the latest accepted snapshot for each output and records which renderer session has acknowledged which revision.
3. Each output renderer owns applied and rendered truth. It accepts only snapshots for its output and current protocol, rejects stale revisions, applies a snapshot atomically, and separately reports the exact revision/hash that reached the store and the revision/hash that reached a terminal rendered or render-failed state.

No process infers synchronization from elapsed time, absent fields, local fallback state, or the order in which asynchronous media finishes loading.

## Authoritative Snapshot

The existing output configuration remains separate from transient presentation state. Each delivered snapshot has a typed envelope:

```ts
export const OUTPUT_STATE_PROTOCOL_VERSION = 1

export type OutputPresentationMode = "live" | "cleared"

export interface OutputStateSnapshot {
    protocolVersion: typeof OUTPUT_STATE_PROTOCOL_VERSION
    outputId: string
    revision: number
    contentHash: string
    presentation: {
        mode: OutputPresentationMode
        out: OutData
    }
}
```

`revision` is monotonic within the lifetime of the main renderer. `contentHash` is computed from the canonical serialized presentation payload and detects payload corruption or accidental revision reuse. The snapshot is a full replacement, never a delta.

`presentation.mode` is mandatory. In `cleared` mode, output renderers suppress all presentation content even if style, template, cached media, or asynchronous loaders still contain data. The authoritative `out` payload is also normalized to contain no slide, explicit background, effects, overlays, or transition. This gives defense in depth: the data is cleared at the source and the renderer enforces the explicit mode.

When Restore is invoked, the cached pre-clear `OutData` becomes a new `live` snapshot with a new revision. Sending a non-null slide or background live also changes the affected output to `live` in the same atomic state update. Overlay-only and timer-only actions do not implicitly leave `cleared` mode.

## Protocol

The output-state channel uses these typed messages:

- `OUTPUT_STATE_PUBLISH`: main renderer → Electron. Carries a complete snapshot.
- `OUTPUT_STATE_READY`: output renderer → Electron. Carries `outputId`, a new renderer `sessionId`, and supported protocol version.
- `OUTPUT_STATE_APPLY`: Electron → one output renderer. Carries the cached latest snapshot and target `sessionId`.
- `OUTPUT_STATE_APPLIED`: output renderer → Electron. Carries `outputId`, `sessionId`, `revision`, and `contentHash` after atomic store application and a Svelte tick.
- `OUTPUT_STATE_RENDERED`: output renderer → Electron. Carries the same identity after every required layer has either committed its visual state or reported a typed render failure.
- `OUTPUT_STATE_REJECTED`: output renderer → Electron. Carries the same identity fields and a typed rejection reason such as unsupported protocol, invalid snapshot, wrong output, stale revision, or hash mismatch.
- `OUTPUT_STATE_NEEDED`: Electron → main renderer. Requests the current authoritative snapshot when an output becomes ready before Electron has cached one.
- `OUTPUT_STATE_HEALTH`: Electron → main renderer. Carries observed delivery state for operator-facing status.

Electron obtains the output identity from the sender's registered `webContents`, not solely from untrusted payload data. It forwards a snapshot only to the matching output window.

## Data Flow

### Normal update

1. A domain action atomically updates an output's presentation state in the main renderer.
2. The publisher assigns the next revision, creates the canonical full snapshot, computes its hash, and sends it to Electron.
3. Electron validates the envelope, output identity, protocol version, revision, and hash before replacing its cached snapshot.
4. Electron sends the snapshot to the current renderer session for that output.
5. The renderer validates the snapshot, ignores revisions older than or equal to its last applied revision, replaces its local presentation state atomically, waits for the next Svelte update tick, and acknowledges the exact applied revision/hash.
6. DOM and Pixi layer adapters report completion or a typed media/render failure for that revision. The renderer sends `OUTPUT_STATE_RENDERED` only after every required layer reaches one of those terminal states.
7. Electron marks delivery synchronized only when APPLIED matches its latest cached revision, hash, and current session. It records rendered health separately so a missing/corrupt media file is not mistaken for a dead renderer.

### Startup and recreation

The output renderer registers its receiver first, generates a new session ID, and sends `OUTPUT_STATE_READY`. Electron immediately responds with its cached latest snapshot. If no snapshot exists, Electron sends `OUTPUT_STATE_NEEDED` to the main renderer and applies the resulting publication. This replaces the existing fixed startup waits and delayed initial `OUTPUTS` resend for presentation state.

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

Electron tracks a delivery record per output: current session, latest revision/hash, applied acknowledgement, rendered result, retry count, and last observed timestamp.

- If the latest revision is not acknowledged within 500 ms, Electron resends the latest full snapshot.
- Electron retries at 500 ms, 1 second, and 2 seconds. A newer published revision supersedes the retry schedule immediately.
- After three missed acknowledgements, Electron marks the output unhealthy, reports that observed fact to the main renderer, and recreates the output window once.
- Recreated windows must complete a fresh READY/APPLY/APPLIED handshake.
- A circuit breaker permits at most one automatic recreation for an output within 30 seconds. If the recreated renderer still fails, Electron leaves it unhealthy and shows an operator warning instead of looping.
- A later valid acknowledgement returns the output to healthy status.
- Render completion has a separate media-aware deadline. A typed render failure or deadline expiry is reported to the operator with the affected layer and revision, but does not recreate a responsive renderer. A newer snapshot cancels the older render deadline.

Retries always resend the full latest snapshot. No retry replays superseded state.

## Validation and Error Handling

All protocol messages use runtime type guards in addition to TypeScript types. Invalid messages are rejected without mutating cached or rendered state.

Electron rejects:

- unknown output IDs or sender/output identity mismatches;
- unsupported protocol versions;
- non-integer, non-positive, or non-monotonic revisions;
- malformed presentation data;
- content hashes that do not match canonical payload serialization.

Output renderers reject wrong-output, wrong-session, unsupported, malformed, or hash-mismatched snapshots. Stale snapshots are acknowledged as stale observations but are never applied.

Diagnostic logs contain output ID, renderer session, revision, message type, retry count, and typed reason. They do not log full show content or local media paths.

## Compatibility and Migration

The new state protocol is introduced alongside existing output support channels. `OUTPUTS` remains temporarily available for output configuration and stage-mirror consumers, but presentation rendering no longer depends on its timing. Once all presentation consumers use snapshots, presentation fields can be removed from redundant `OUTPUTS` delivery in a separate cleanup.

The existing `getOutputReceiverSignature` optimization must not control authoritative snapshot application. Revision and hash are the only synchronization identity.

Transient presentation snapshots and broker revisions are not written to saved settings. On a full app restart, outputs begin from the normal empty live state established by startup settings.

## Components

- `src/types/OutputState.ts`: protocol envelopes, mode, health, rejection reasons, and runtime guards.
- Main-renderer publisher: creates canonical snapshots and revisions from atomic output-domain updates.
- Electron output-state broker: validates, caches, routes, retries, tracks sessions/acknowledgements, and invokes bounded recreation.
- Output-renderer client: READY handshake, validation, stale rejection, atomic application, and APPLIED acknowledgement.
- Output rendering resolver: derives visible style/template/explicit background from authoritative presentation mode and invalidates old asynchronous render work on clear.

Each component has a narrow interface and can be tested without opening Electron windows.

## Testing

### Unit tests

- Canonical hashing is stable for equivalent snapshots and changes for every presentation mutation.
- Runtime guards reject malformed versions, IDs, revisions, modes, payloads, and hashes.
- Broker accepts only increasing revisions, routes only to the matching output, and never replaces truth with invalid/stale data.
- READY sends the latest cached snapshot to the current session.
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
- Multi-output updates preserve independent revisions, modes, sessions, and health.

### Verification

Run focused Node tests, Svelte type checking, frontend/Electron linting, formatting checks, and the production build. Manually verify Clear All, Restore, rapid slide/media changes, output toggling, and forced output-window recreation with both WebGPU enabled and disabled.

## Success Criteria

- Clear All always produces a completely blank active output and remains blank until Restore or new live slide/background content.
- No stale snapshot or late media load can overwrite a newer revision.
- Output startup and recovery use observed readiness and acknowledgements, not fixed delays.
- The operator can distinguish synchronized, retrying, recovering, and unhealthy output states.
- Every presentation-state decision can be traced to a validated authoritative snapshot or an observed protocol event.
