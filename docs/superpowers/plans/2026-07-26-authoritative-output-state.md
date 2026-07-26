# Authoritative Output State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace timing-dependent main-to-output state delivery with validated, revisioned full-topic snapshots and make Clear All an explicit atomic state that suppresses every output layer.

**Architecture:** The main renderer publishes full snapshots from authoritative Svelte stores. Electron brokers, caches, retries, and observes acknowledgements per topic and output-renderer session. Output renderers apply snapshots through explicit topic adapters, gate output revisions on dependency revisions, and enforce `presentationMode: "cleared"` before resolving any style, template, DOM, or Pixi content.

**Tech Stack:** Electron IPC, Svelte 3 writable stores, TypeScript 4.9, Node test runner, PixiJS/WebGPU and DOM output renderers.

## Global Constraints

- Preserve the user's existing changes in `src/electron/data/thumbnails.ts`, `src/frontend/audio/audioPlayer.ts`, and `src/frontend/components/drawer/audio/Audio.svelte`.
- Keep high-frequency time/audio/buffer samples on their existing low-latency channels; synchronize only their latest baseline through the reliable protocol.
- Use full topic snapshots, never deltas.
- Do not use fixed startup sleeps to establish readiness or state ordering.
- Runtime state and revisions must not be persisted in saved output settings.
- Clear All removes locked overlays as well as ordinary overlays because “all” is authoritative.
- Every production change starts with a test that fails for the expected behavioral reason.

---

### Task 1: Shared snapshot protocol and canonical identity

**Files:**
- Create: `src/types/OutputState.ts`
- Create: `src/common/outputState/snapshot.ts`
- Test: `scripts/tests/output-state-snapshot.test.mjs`

**Interfaces:**
- Produces: `OutputStateTopic`, `OutputStateScope`, `OutputTopicSnapshot`, protocol message types, `outputStateKey()`, `canonicalizeOutputState()`, `hashOutputStatePayload()`, `createOutputTopicSnapshot()`, and runtime guards.
- Consumes: `Output`, `OutData`, and existing shared-domain types only as type imports.

- [ ] **Step 1: Write failing canonicalization and validation tests**

```js
test("equivalent payload key order has one canonical hash", () => {
    assert.equal(hashOutputStatePayload({ b: 2, a: 1 }), hashOutputStatePayload({ a: 1, b: 2 }))
})

test("snapshot validation rejects malformed scope and revisions", () => {
    assert.equal(isOutputTopicSnapshot({ protocolVersion: 1, topic: "output", scope: { kind: "output" }, revision: 0, contentHash: "x", payload: {} }), false)
})

test("snapshot validation rejects a mismatched content hash", () => {
    const snapshot = createOutputTopicSnapshot("styles", { kind: "shared" }, 1, { default: { name: "Default" } })
    assert.equal(isValidOutputTopicSnapshot({ ...snapshot, payload: {} }), false)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/tests/output-state-snapshot.test.mjs`

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement the minimal shared protocol**

```ts
export const OUTPUT_STATE_PROTOCOL_VERSION = 1 as const
export const OUTPUT_STATE_TOPICS = ["output", "language", "styles", "transition", "shows", "categories", "templates", "overlays", "events", "groups", "draw", "drawTool", "drawSettings", "media", "outputSlideCache", "effects", "timers", "activeTimers", "variables", "timeFormat", "special", "slideTimelineSpeedMultiplier", "playerVideos", "stage", "projects", "activeProject", "showsData", "customMetadata", "customCredits", "volume", "gain", "audioChannelsData", "equalizerConfig", "metronome", "metronomeTimer", "playingAudio", "colorbars", "livePrepare", "mediaControlBaseline"] as const

export type OutputStateTopic = (typeof OUTPUT_STATE_TOPICS)[number]
export type OutputStateScope = { kind: "shared" } | { kind: "output"; outputId: string }
export type OutputPresentationMode = "live" | "cleared"

export interface OutputTopicSnapshot<T = unknown> {
    protocolVersion: typeof OUTPUT_STATE_PROTOCOL_VERSION
    topic: OutputStateTopic
    scope: OutputStateScope
    revision: number
    contentHash: string
    dependencies?: Record<string, number>
    payload: T
}
```

Implement sorted-key canonical serialization without a `WeakMap`, reject cyclic/non-serializable values, and use one deterministic pure-JavaScript hash implementation in every process. `isValidOutputTopicSnapshot()` must recompute the hash.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test scripts/tests/output-state-snapshot.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the protocol slice**

```bash
git add src/types/OutputState.ts src/common/outputState/snapshot.ts scripts/tests/output-state-snapshot.test.mjs
git commit -m "feat(output): define authoritative state snapshots"
```

### Task 2: Pure broker state machine with retries and circuit breaker

**Files:**
- Create: `src/electron/output/OutputStateBroker.ts`
- Test: `scripts/tests/output-state-broker.test.mjs`

**Interfaces:**
- Consumes: shared snapshot/message types and injected `BrokerTransport`, `BrokerScheduler`.
- Produces: `OutputStateBroker.publish()`, `.ready()`, `.applied()`, `.rendered()`, `.rejected()`, `.removeSession()`, and `.dispose()`.

- [ ] **Step 1: Write failing broker contract tests with a fake clock/transport**

```js
test("ready receives a manifest and every latest required topic", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(sharedStylesRevision1)
    harness.broker.publish(outputOneRevision1)
    harness.broker.ready({ outputId: "one", sessionId: "session-a", protocolVersion: 1 }, harness.sender("one"))

    assert.deepEqual(harness.sentTo("one").map((message) => message.channel), ["OUTPUT_STATE_MANIFEST", "OUTPUT_STATE_APPLY", "OUTPUT_STATE_APPLY"])
})

test("stale acknowledgements cannot satisfy the latest revision", () => {
    const harness = createBrokerHarness()
    harness.readyAndPublish(outputOneRevision1, outputOneRevision2)
    harness.broker.applied(ackFor(outputOneRevision1), harness.sender("one"))
    assert.equal(harness.health("one").status, "syncing")
})

test("three missed acknowledgements recreate once and open the circuit", () => {
    const harness = createBrokerHarness()
    harness.readyAndPublish(outputOneRevision1)
    harness.clock.advanceBy(3500)
    assert.deepEqual(harness.recreated, ["one"])
    harness.clock.advanceBy(3500)
    assert.deepEqual(harness.recreated, ["one"])
    assert.equal(harness.health("one").status, "unhealthy")
})
```

- [ ] **Step 2: Run the broker test and verify RED**

Run: `node --test scripts/tests/output-state-broker.test.mjs`

Expected: FAIL because the broker does not exist.

- [ ] **Step 3: Implement broker caching, identity checks, manifesting, acknowledgement matching, retries, and recovery**

```ts
export interface BrokerTransport {
    sendToOutput(outputId: string, message: OutputStateToRendererMessage): void
    sendToMain(message: OutputStateToMainMessage): void
    recreateOutput(outputId: string): void
}

export interface BrokerScheduler {
    now(): number
    setTimeout(callback: () => void, delay: number): unknown
    clearTimeout(handle: unknown): void
}
```

Cache snapshots by `outputStateKey(topic, scope)`. Authenticate renderer-originated messages against the output ID resolved from `webContents.id`. Retry the latest unacknowledged snapshot at 500 ms, 1 second, and 2 seconds. A new snapshot cancels the superseded retry. Allow one recreation per output per 30 seconds; then emit `unhealthy` without another recreation.

- [ ] **Step 4: Run the broker test and verify GREEN**

Run: `node --test scripts/tests/output-state-broker.test.mjs`

Expected: PASS with fake time; no real sleep.

- [ ] **Step 5: Commit the broker slice**

```bash
git add src/electron/output/OutputStateBroker.ts scripts/tests/output-state-broker.test.mjs
git commit -m "feat(output): broker reliable state delivery"
```

### Task 3: Authoritative main-renderer publisher and topic registry

**Files:**
- Create: `src/frontend/outputState/OutputStatePublisher.ts`
- Create: `src/frontend/outputState/topics.ts`
- Test: `scripts/tests/output-state-publisher.test.mjs`
- Modify: `src/frontend/utils/listeners.ts`
- Modify: `src/frontend/utils/startup.ts`

**Interfaces:**
- Consumes: authoritative Svelte stores and `send(OUTPUT, ...)`.
- Produces: `createOutputStatePublisher(sendSnapshot)`, `startOutputStatePublisher()`, `publishAllCurrentTopics()`, and `publishNeededTopics(keys)`.

- [ ] **Step 1: Write failing publisher tests**

```js
test("publisher revisions are monotonic per topic and scope", () => {
    const sent = []
    const publisher = createOutputStatePublisher((snapshot) => sent.push(snapshot))
    publisher.publish("styles", { kind: "shared" }, { default: { name: "One" } })
    publisher.publish("styles", { kind: "shared" }, { default: { name: "Two" } })
    publisher.publish("output", { kind: "output", outputId: "a" }, outputA)
    assert.deepEqual(sent.map((snapshot) => snapshot.revision), [1, 2, 1])
})

test("output snapshot dependency vector uses observed published topic revisions", () => {
    const publisher = createOutputStatePublisher(() => {})
    publisher.publish("styles", { kind: "shared" }, styles)
    publisher.publish("shows", { kind: "shared" }, shows)
    const snapshot = publisher.publishOutput("a", outputA)
    assert.equal(snapshot.dependencies["styles:shared"], 1)
    assert.equal(snapshot.dependencies["shows:shared"], 1)
})
```

- [ ] **Step 2: Run the publisher test and verify RED**

Run: `node --test scripts/tests/output-state-publisher.test.mjs`

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement the publisher and explicit topic/store adapters**

`topics.ts` must map every durable entry currently in `initalOutputData` and `storeSubscriber()` to its actual source store and payload shape, plus per-output state and `mediaControlBaseline`. `BUFFER`, `TIME`, `AUDIO_DATA`, `DYNAMIC_VALUE_DATA`, and `VISUALIZER_DATA` remain sequenced sample streams. Publisher startup subscribes shared topics first and publishes output topics only after every required dependency has an observed revision. Before every output publication, synchronously sample the actual dependency stores with `get()`, publish any changed values, and build the dependency vector from those observed revisions. `OUTPUT_STATE_NEEDED` forces a fresh snapshot from the named source store rather than replaying a publisher-local guess.

During migration, keep legacy sends in place, but remove the 100 ms delayed `OUTPUTS` resend as a source of presentation truth. Start the publisher only in `startupMain()` after authoritative settings stores load.

- [ ] **Step 4: Run publisher and existing listener tests**

Run: `node --test scripts/tests/output-state-publisher.test.mjs scripts/tests/output-signatures.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the publisher slice**

```bash
git add src/frontend/outputState src/frontend/utils/listeners.ts src/frontend/utils/startup.ts scripts/tests/output-state-publisher.test.mjs
git commit -m "feat(output): publish state from authoritative stores"
```

### Task 4: Electron IPC integration and READY-driven startup

**Files:**
- Modify: `src/electron/output/OutputHelper.ts`
- Modify: `src/electron/output/helpers/OutputLifecycle.ts`
- Modify: `src/electron/output/helpers/OutputSend.ts`
- Modify: `src/electron/output/Output.ts`
- Test: `scripts/tests/output-state-routing.test.mjs`

**Interfaces:**
- Consumes: `OutputStateBroker` and real Electron sender/window identities.
- Produces: authenticated broker routing and lifecycle session cleanup.

- [ ] **Step 1: Write a failing routing test**

```js
test("renderer payload cannot impersonate another output", () => {
    const harness = createRoutingHarness({ senderWebContentsId: 10, registeredOutputId: "one" })
    harness.receive({ channel: "OUTPUT_STATE_READY", data: { outputId: "two", sessionId: "s", protocolVersion: 1 } })
    assert.equal(harness.brokerReadyCalls.length, 0)
    assert.equal(harness.rejections[0].reason, "sender_output_mismatch")
})
```

- [ ] **Step 2: Run the routing test and verify RED**

Run: `node --test scripts/tests/output-state-routing.test.mjs`

Expected: FAIL because sender-to-output resolution does not exist.

- [ ] **Step 3: Integrate the broker at the Electron boundary**

Add `webContentsId` lookup to `OutputHelper`, pass `IpcMainEvent` into reliable-message handling, authenticate publications as main-window messages, and authenticate READY/APPLIED/RENDERED/REJECTED against registered output windows. Remove a renderer session from the broker when its window closes. Keep generic legacy forwarding for non-reliable channels during migration.

- [ ] **Step 4: Run routing and broker tests**

Run: `node --test scripts/tests/output-state-routing.test.mjs scripts/tests/output-state-broker.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Electron integration**

```bash
git add src/electron/output scripts/tests/output-state-routing.test.mjs
git commit -m "feat(output): authenticate reliable IPC sessions"
```

### Task 5: Output-renderer client, dependency gate, and store adapters

**Files:**
- Create: `src/frontend/outputState/OutputStateClient.ts`
- Create: `src/frontend/outputState/applyTopic.ts`
- Create: `src/common/outputState/dependencyGate.ts`
- Test: `scripts/tests/output-state-client.test.mjs`
- Modify: `src/frontend/utils/startup.ts`
- Modify: `src/frontend/utils/receivers.ts`

**Interfaces:**
- Consumes: manifests/snapshots and existing target Svelte stores.
- Produces: READY handshake, `applyTopicSnapshot()`, dependency gating, APPLIED/REJECTED messages, and baseline handoff.

- [ ] **Step 1: Write failing client/dependency tests**

```js
test("output waits for exact dependency revisions", () => {
    const gate = createDependencyGate()
    gate.receive(outputRevision2DependingOnStyles3)
    assert.equal(gate.takeReady(), null)
    gate.markApplied("styles:shared", 3)
    assert.equal(gate.takeReady().revision, 2)
})

test("older topic snapshots are rejected without mutating the target", async () => {
    const harness = createClientHarness()
    await harness.apply(stylesRevision2)
    await harness.apply(stylesRevision1)
    assert.deepEqual(harness.styles, stylesRevision2.payload)
    assert.equal(harness.rejections.at(-1).reason, "stale_revision")
})
```

- [ ] **Step 2: Run the client test and verify RED**

Run: `node --test scripts/tests/output-state-client.test.mjs`

Expected: FAIL because the client and gate do not exist.

- [ ] **Step 3: Implement client and explicit topic adapters**

Register the OUTPUT receiver before sending READY. Generate a fresh session ID for each renderer process. Validate snapshot and session identity, apply the payload through an exhaustive topic switch to the actual target store, `await tick()`, then send APPLIED. The `output` adapter replaces the renderer's single matching output entry and never uses `getOutputReceiverSignature`. Buffer an output snapshot until its dependency vector is satisfied.

Remove the 200 ms startup wait and `REQUEST_DATA_MAIN` timing handshake after the reliable manifest path is active. Keep handlers for high-frequency samples and temporary legacy fallback.

- [ ] **Step 4: Run client, snapshot, and receiver-signature tests**

Run: `node --test scripts/tests/output-state-client.test.mjs scripts/tests/output-state-snapshot.test.mjs scripts/tests/output-signatures.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the renderer client**

```bash
git add src/frontend/outputState src/common/outputState/dependencyGate.ts src/frontend/utils/startup.ts src/frontend/utils/receivers.ts scripts/tests/output-state-client.test.mjs
git commit -m "feat(output): apply revisioned state snapshots"
```

### Task 6: Atomic Clear All and renderer-level suppression

**Files:**
- Modify: `src/types/Output.ts`
- Create: `src/frontend/components/output/presentationState.ts`
- Test: `scripts/tests/output-presentation-state.test.mjs`
- Modify: `src/frontend/components/output/clear.ts`
- Modify: `src/frontend/components/helpers/output.ts`
- Modify: `src/frontend/components/output/Output.svelte`
- Modify: `src/frontend/components/output/preview/ClearButtons.svelte`
- Modify: `src/frontend/components/output/webgpu/WebGPUOutput.svelte`

**Interfaces:**
- Produces: `OutData.presentationMode`, `clearOutputPresentations()`, `activateOutputPresentation()`, and `resolveVisibleBackgrounds()`.
- Consumes: authoritative output store and existing cleanup functions for audio, timers, and media tracking.

- [ ] **Step 1: Write failing presentation-state tests**

```js
test("Clear All atomically removes every output layer including locked overlays", () => {
    const cleared = clearPresentation(activeOutputWithEveryLayer)
    assert.deepEqual(cleared.out, { presentationMode: "cleared", background: null, slide: null, overlays: [], effects: [], transition: null })
})

test("cleared mode suppresses explicit, template, and style backgrounds", () => {
    assert.deepEqual(resolveVisibleBackgrounds({ presentationMode: "cleared", explicit: media, template: templateMedia, style: styleMedia }), { style: null, content: null })
})

test("new slide or background activates output but overlay-only updates do not", () => {
    assert.equal(nextPresentationMode("cleared", "slide", { id: "show" }), "live")
    assert.equal(nextPresentationMode("cleared", "overlays", ["overlay"]), "cleared")
})
```

- [ ] **Step 2: Run presentation-state test and verify RED**

Run: `node --test scripts/tests/output-presentation-state.test.mjs`

Expected: FAIL because explicit presentation mode and resolver do not exist.

- [ ] **Step 3: Implement one atomic Clear All state update**

Add `presentationMode?: "live" | "cleared"` to `OutData`; normalize missing legacy values to `live` only at the publisher boundary. Replace sequential `setOutput()` calls in `clearAll()` with one immutable `outputs.update()` over the exact active output IDs. Clear locked overlays, effects, transitions, slide/background, timer/video state, then trigger existing custom actions once. Preserve the pre-clear cache for Restore. Restore and non-null slide/background changes set `presentationMode: "live"` in the same store update.

- [ ] **Step 4: Enforce clear mode before every background fallback**

Use `resolveVisibleBackgrounds()` in `Output.svelte` so clear mode returns no style, template, or explicit background. Pass clear mode through `WebGPUOutput.svelte`; synchronously clear both Pixi slots and invalidate pending requests. Ensure DOM background components unmount. Update ClearButtons' `allCleared` calculation to use authoritative mode instead of inferring from missing fields.

- [ ] **Step 5: Run presentation and stale-request tests**

Run: `node --test scripts/tests/output-presentation-state.test.mjs scripts/tests/latest-request.test.mjs scripts/tests/pixi-background-bridge.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Clear All behavior**

```bash
git add src/types/Output.ts src/frontend/components/output src/frontend/components/helpers/output.ts scripts/tests/output-presentation-state.test.mjs
git commit -m "fix(output): make Clear All authoritative"
```

### Task 7: Render observations, health reporting, and stateful-channel cutover

**Files:**
- Create: `src/frontend/outputState/RenderRevisionTracker.ts`
- Test: `scripts/tests/output-render-revision.test.mjs`
- Modify: `src/frontend/components/output/Output.svelte`
- Modify: `src/frontend/components/output/layers/Background.svelte`
- Modify: `src/frontend/components/output/layers/BackgroundMedia.svelte`
- Modify: `src/frontend/components/output/webgpu/pixiBackgroundBridge.ts`
- Modify: `src/frontend/components/output/webgpu/WebGPUOutput.svelte`
- Modify: `src/frontend/stores.ts`
- Modify: `src/frontend/utils/receivers.ts`
- Modify: `src/frontend/utils/listeners.ts`

**Interfaces:**
- Produces: per-revision layer terminal-state tracking, RENDERED/failed observations, and `outputStateHealth`.

- [ ] **Step 1: Write failing render-tracker tests**

```js
test("rendered emits only after every required layer reaches a terminal state", () => {
    const tracker = new RenderRevisionTracker(["styleBackground", "background", "slide"])
    tracker.complete("styleBackground")
    tracker.complete("background")
    assert.equal(tracker.result(), null)
    tracker.complete("slide")
    assert.equal(tracker.result().status, "rendered")
})

test("new revision invalidates terminal events from the old revision", () => {
    const tracker = createRevisionHarness(1)
    tracker.start(2, ["background"])
    tracker.completeFor(1, "background")
    assert.equal(tracker.result(), null)
})
```

- [ ] **Step 2: Run the render-tracker test and verify RED**

Run: `node --test scripts/tests/output-render-revision.test.mjs`

Expected: FAIL because the tracker does not exist.

- [ ] **Step 3: Integrate observed render terminal states**

Start a tracker for each applied output revision using the layers actually required by resolved output data. DOM media emits loaded/error; Pixi bridge resolves update/clear promises with loaded/error; slide content reports after its Svelte commit. Ignore events carrying older revisions. Send RENDERED with `rendered` or typed `render_failed` details only when all required layers are terminal.

- [ ] **Step 4: Surface observed broker health**

Store `OUTPUT_STATE_HEALTH` by output ID. Show one operator toast when an output enters recovering or unhealthy, and one recovery toast when it returns healthy. Deduplicate by status transition; never infer health locally.

- [ ] **Step 5: Remove redundant stateful delivery only after parity tests pass**

Delete main-to-output legacy sends covered by the reliable topic registry and their output receiver branches. Retain `ALL_OUTPUTS` for stage mirrors and retain high-frequency BUFFER/TIME/DATA/audio channels. Remove `sendInitialOutputData()`, `REQUEST_DATA_MAIN`, the 100 ms output resend, and state-ordering comments.

- [ ] **Step 6: Run focused state tests and verify GREEN**

Run: `node --test scripts/tests/output-state-*.test.mjs scripts/tests/output-presentation-state.test.mjs scripts/tests/latest-request.test.mjs scripts/tests/pixi-background-bridge.test.mjs`

Expected: PASS with no open timers.

- [ ] **Step 7: Commit cutover and observations**

```bash
git add src/frontend/outputState src/frontend/components/output src/frontend/stores.ts src/frontend/utils/listeners.ts src/frontend/utils/receivers.ts scripts/tests/output-render-revision.test.mjs
git commit -m "feat(output): observe render convergence and health"
```

### Task 8: Full verification and flow-audit handoff

**Files:**
- Create: `docs/output-flow-audit.md`

**Interfaces:**
- Produces: verified authoritative-state implementation and an evidence table that seeds the remaining four output workstreams.

- [ ] **Step 1: Run all focused Node regression tests**

Run: `node --test scripts/tests/*.test.mjs`

Expected: all tests pass; no leaked timer/process warnings.

- [ ] **Step 2: Run formatting, type, and lint verification**

Run: `npx prettier --config config/formatting/.prettierrc.yaml --check src scripts docs/superpowers/specs docs/superpowers/plans`

Run: `npx svelte-check --tsconfig config/typescript/tsconfig.svelte.json`

Run: `npm run lint:electron`

Run: `npm run lint:frontend`

Run: `npm run lint:svelte`

Run: `npm run lint:styles`

Expected: all exit 0. Record unrelated pre-existing failures without modifying unrelated user work.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 4: Execute the manual output matrix**

Verify with WebGPU on and off: initial output startup, rapid show/slide changes, image/video backgrounds, template/style fallbacks, Clear All, Restore, locked overlays, multiple active outputs, output toggle/recreation, missing media, and stale async load cancellation. For every case, compare main published revision, broker cached revision, output APPLIED revision, and terminal render result.

- [ ] **Step 5: Write the remaining flow inventory with evidence**

Create `docs/output-flow-audit.md` with one row per flow: source of truth, IPC path, output consumer, observed revision/sequence, test/instrumentation, result, and follow-up workstream. Include lifecycle/visibility/bounds, DOM/Pixi parity, video/audio clocks, capture/preview, stage, NDI, and Blackmagic.

- [ ] **Step 6: Commit verification documentation**

```bash
git add docs/output-flow-audit.md
git commit -m "docs: inventory verified output flows"
```
