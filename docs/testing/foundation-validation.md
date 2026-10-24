# Presentation foundation validation

Validation record for the FreeShow 1.13.3 release candidate. This captures reported automated evidence at the current implementation checkpoint; it is not a release sign-off or a hardware qualification.

| Check | Result | Scope and limits |
| --- | --- | --- |
| Output lifecycle and mirrored-preview Playwright suites | **Pass: 6 tests** | Ran against the current generated bundle under Xvfb: `output-playback-lifecycle.test.ts` and `output-preview-playback.test.ts`. This is the verified six-test set, not a claim that every acceptance test passed. |
| Remote PowerPoint thumbnail/preview regression | **Pass** | Browser regression passed for the implemented #52 fix; release is still pending. See [issue #52](https://github.com/ccfii-engineering/ccfii-free-show/issues/52). |
| `npm run test:unit` | **Pass: 162 Node + 28 Vitest tests** | The project-owned command runs `test:unit:node` plus six selected TypeScript suites, including the remote-browser request fix. |
| Broader unfiltered Vitest invocation | **Not clean: 135 passed, 13 failed** | Failures were in cloud, streaming, and HTTP-related tests. No full baseline comparison was run, so this record does not classify them as regressions or proven pre-existing failures. |
| Svelte diagnostic comparison | **Baseline remains red; no new normalized diagnostics** | Current: 252 errors, 59 warnings, and 233 hints. HEAD baseline: 257 errors, 59 warnings, and 233 hints. The normalized diff found no current-only diagnostics; five baseline-only diagnostics are gone (four media-scan errors and one missing `pixi.js` diagnostic from the retired renderer dependency). Compare individual diagnostics with [baseline issue #47](https://github.com/ccfii-engineering/ccfii-free-show/issues/47); totals alone cannot establish parity. |
| Physical and native output qualification | **Not measured** | Run the platform/device checks in the [output acceptance checklist](output-acceptance.md) and [distribution compatibility matrix](distribution-compatibility.md). |

Issue #53 layout behavior remains deferred and unreproduced. See the [Presentation IPC foundation spec](https://github.com/ccfii-engineering/ccfii-free-show/issues/45) and its implementation tickets [#46–#51](https://github.com/ccfii-engineering/ccfii-free-show/issues/51) for scope and tracking.
