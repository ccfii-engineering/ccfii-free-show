---
status: accepted
---

# Pin grandiose's `tmp` with an override; keep grandiose

`npm audit --omit=dev` flagged `tmp` (path traversal via unsanitized `prefix`/`postfix`, fixed in 0.2.6) under `grandiose`, the NDI add-on we install from the ChurchApps git fork. The fork pins `tmp` to exactly `0.2.5` and has no upstream release to take, so audit reports "no fix available".

## Decision

Keep `grandiose` and add an npm override (`overrides.grandiose.tmp: ^0.2.7`) so it resolves the same patched `tmp` the app already depends on directly. Do not replace or fork grandiose for this advisory.

## Exposure analysis

- `tmp` is imported only by grandiose's `ndi.js`, the install-time script that downloads the NDI SDK (`tmp.tmpNameSync()` with no arguments). It is not loaded at runtime: `index.js` loads the native binding through `bindings`.
- The vulnerable inputs (`prefix`, `postfix`, `template`) are never passed, so no external input reaches `tmp` in the app or in that script. Its URLs are hard-coded NDI SDK downloads.
- Within FreeShow, `tmp` is not reachable from untrusted input (remote, stage, controller, imported shows or media).
- Rating before the override: low exposure, but it kept `npm audit` red. The override removes the finding without changing grandiose code.

## Consequences

- `tmp` 0.2.7 keeps the `tmpNameSync` API used by `ndi.js`; the override is checked by the Electron runtime test (grandiose must still load).
- If grandiose later changes how it uses `tmp`, or the fork is rebased, revisit the override. Replacing NDI output is a separate product decision and is not driven by this advisory.
- `@discordjs/opus` 0.11 still depends on `@discordjs/node-pre-gyp`, which pins the vulnerable `tar` 6. Another override (`@discordjs/node-pre-gyp.tar: ^7.5.22`) points it at the patched `tar` 7. node-pre-gyp only uses `tar` at install time to unpack a prebuilt binary; the source build path was verified with it.
