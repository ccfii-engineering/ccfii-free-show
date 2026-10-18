# Broadcast and production hardware scope for a Windows-first CCFII worship app

**Decision ticket:** [Recommend the initial broadcast and production-hardware scope](https://github.com/ccfii-engineering/ccfii-free-show/issues/32)
**Parent map:** [Wayfinder: CCFII native FreeShow successor](https://github.com/ccfii-engineering/ccfii-free-show/issues/24)
**Recommendation date:** 2026-10-18

## Recommendation

Treat these as product-scope recommendations, not evidence that CCFII currently uses each workflow. The repository is a FreeShow codebase and contains no CCFII service logs, device inventory, or usage measurements for these eight features. The recommendation assumes a typical Windows-first worship setup where the presentation computer may feed a separate production/streaming computer and operators benefit from a simple browser preview. Validate these assumptions against CCFII's actual Windows hardware before committing to vendor-device support.

| ID | Recommendation | Why |
| --- | --- | --- |
| B01 Send NDI output | **Include** | A practical network handoff to a separate production computer or OBS, without requiring a dedicated video I/O card. Keep it as a Distribution Target fed by the composed Presentation Output. |
| B02 Receive NDI sources | **Later** | Useful when a team already routes cameras or other network sources over NDI, but the input inventory and need are unverified. It adds source discovery, reconnect, and live-input routing work. |
| B03 Send through Blackmagic hardware | **Later; confirm owned hardware first** | Appropriate for SDI/keyed output in a production setup that owns compatible DeckLink/UltraStudio hardware. This is hardware-specific and has a system SDK/driver dependency; no CCFII device inventory was found. |
| B04 Receive Blackmagic sources | **Later; confirm owned hardware first** | Useful for ingesting a camera or other SDI/HDMI feed through a Blackmagic capture device. Defer until CCFII identifies a real device and mode to qualify. |
| B05 WebRTC output | **Later** | The current implementation is WHIP-oriented. It may serve a WebRTC ingest endpoint, but it introduces a distinct signaling/session/security and endpoint-compatibility path. Use the production system's established streaming path until a concrete WHIP destination is named. |
| B06 RTMP output | **Later** | Direct platform streaming is useful, but overlaps with the production/encoding role of OBS. Defer a second encoder and stream-management surface until direct-to-platform operation is a demonstrated CCFII requirement. |
| B07 Browser-viewable output stream | **Include, bounded to local-network viewing** | A useful low-setup confidence/display client for a browser-capable device. Preserve it as a browser client for the composed output, with explicit local-network and performance limits; do not treat it as a public internet CDN service. |
| B08 OBS integration | **Include** | Controlling OBS scenes, stream, and recording complements a projection app while leaving encoding, platform credentials, and production scenes in the team's existing production software. Use the OBS WebSocket interface and require its authentication when configured. |

### Why these are separate choices

The existing app already treats NDI, Blackmagic, WebRTC, RTMP, and browser output as downstream targets of a captured composed output. Its setup UI describes NDI as IP/OBS, WebRTC as WHIP/restream.io, and RTMP as YouTube/Twitch/Facebook Live. The code also exposes OBS scene switching, stream start/stop, and recording start/stop. This establishes source presence and existing integration shapes, not CCFII use or successful CCFII hardware operation. See [`OutputSetup.svelte`](../../src/frontend/components/main/popups/OutputSetup.svelte), [`CaptureTransmitter.ts`](../../src/electron/capture/helpers/CaptureTransmitter.ts), and [`obsTalk.ts`](../../src/frontend/utils/obsTalk.ts).

NDI's first-party SDK documentation describes separate sender and receiver APIs and provides Windows SDK examples. That makes B01/B02 technically plausible, while supporting both directions still means maintaining both paths. [NDI sender documentation](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-send), [NDI receiver documentation](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-recv), [NDI SDK examples](https://docs.ndi.video/all/developing-with-ndi/sdk/example-code).

Blackmagic's Desktop Video SDK supports Windows, macOS, and Linux, exposes capture and playback APIs, and uses the installed product libraries; on Windows it exposes native COM interfaces. Cross-platform support in the vendor SDK does not remove the need to qualify device models, drivers, modes, pixel formats, lifecycle, and keyed output on CCFII's real Windows machines. [Desktop Video SDK overview](https://sdk-doc.blackmagicdesign.com/decklink-sdk/), [supported products, operating systems, and Windows installation features](https://sdk-doc.blackmagicdesign.com/decklink-sdk/section1.html).

OBS includes its WebSocket remote-control interface by default in OBS 28 and later. Its official guide recommends protecting it with a password. The official protocol includes scene-list and program-scene requests as well as stream/record control; this is a comparatively direct integration boundary for B08. [OBS Remote Control Guide](https://obsproject.com/kb/remote-control-guide), [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).

WebRTC is not a single destination address: the WebRTC project documentation describes peer setup using a separately implemented signaling channel and ICE server configuration. The current FreeShow path specifically implements WHIP HTTP signaling. The IETF WHIP standard requires an SDP offer/answer exchange over HTTP and specifies secure transport considerations. This is useful where a named destination accepts WHIP, but not a generic replacement for RTMP or OBS. [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections), [RFC 9725: WHIP](https://www.rfc-editor.org/rfc/rfc9725.html).

B07 is a different operator need from B05/B06: the local source runs an `OUTPUT_STREAM` server and sends captured frames to its browser client. Current code also sends frames to the remote Stage client only when a visible output mirror subscribes. This is source evidence for browser clients, not a measured promise about simultaneous clients, LAN capacity, latency, or internet delivery. See [`servers.ts`](../../src/electron/servers.ts), [`App.svelte`](../../src/server/output_stream/App.svelte), and [`CaptureTransmitter.ts`](../../src/electron/capture/helpers/CaptureTransmitter.ts).

## Source evidence versus observed CCFII use

**Observed in this repository:**

- NDI sender and receiver implementations, Blackmagic sender/receiver paths, WebRTC/WHIP streaming, RTMP encoding/streaming, a Socket.IO browser output client, and OBS WebSocket control are present in source. The selected implementations include `NdiSender.ts`, `NdiReceiver.ts`, `BlackmagicSender.ts`, `WebRtcHost.ts`, `RtmpStreamer.ts`, `servers.ts`, and `obsTalk.ts`.
- `package.json` references the native `grandiose` NDI binding and `macadam` Blackmagic binding. This is a maintenance/deployment consideration, not proof of a particular device being deployed by CCFII.
- The repository's output-flow audit says physical NDI and Blackmagic endpoints still require real-device acceptance testing. The hardware matrix in [`gpu-output-acceptance.md`](../testing/gpu-output-acceptance.md) has no completed Windows, macOS, or Linux results.

**Not observed / evidence missing:**

- No CCFII-specific logs or inventory establishing that any service uses NDI, Blackmagic hardware, WHIP, RTMP, or the browser stream.
- No observation identifying which Windows PCs, cameras, capture/output cards, OBS versions, production destinations, network topology, resolutions, frame rates, or audio routes CCFII needs to support.
- No completed Windows real-device acceptance results for these targets and no verified staff/operator feedback on which workflows are currently relied upon.

Therefore, the “include” calls for NDI send, local browser output, and OBS control are workflow assumptions based on their low-friction role in a Windows-first worship/production setup. They should be confirmed during CCFII hardware inventory and operator validation; the other items remain later until a specific use case justifies their compatibility and support cost.

## Local source pointers

- Feature IDs and original options were taken from the shared checkout planning note `docs/native-feature-selection.md` (untracked and intentionally not copied into this research branch).
- Output routing and hardware-verification boundary: [`docs/output-flow-audit.md`](../output-flow-audit.md).
- Browser/Stage server port and static client: [`src/electron/servers.ts`](../../src/electron/servers.ts), [`src/server/output_stream/App.svelte`](../../src/server/output_stream/App.svelte).
- NDI send/receive: [`src/electron/ndi/NdiSender.ts`](../../src/electron/ndi/NdiSender.ts), [`src/electron/ndi/NdiReceiver.ts`](../../src/electron/ndi/NdiReceiver.ts).
- Blackmagic output and package bindings: [`src/electron/blackmagic/BlackmagicSender.ts`](../../src/electron/blackmagic/BlackmagicSender.ts), [`package.json`](../../package.json).
- WebRTC and RTMP: [`src/electron/streaming/WebRtcHost.ts`](../../src/electron/streaming/WebRtcHost.ts), [`src/electron/streaming/RtmpStreamer.ts`](../../src/electron/streaming/RtmpStreamer.ts), [`src/electron/streaming/encoderProfiles.ts`](../../src/electron/streaming/encoderProfiles.ts).
- OBS controls: [`src/frontend/utils/obsTalk.ts`](../../src/frontend/utils/obsTalk.ts), [`src/frontend/components/settings/tabs/Connection.svelte`](../../src/frontend/components/settings/tabs/Connection.svelte).

## Check

This is a source and documentation review, not a hardware qualification. Confirm each “include” against CCFII operators and their actual Windows production setup before turning it into implementation acceptance criteria. No build or tests were run because the task is a research recommendation.
