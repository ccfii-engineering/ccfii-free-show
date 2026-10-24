# Distribution compatibility matrix

Record runtime checks here after testing a concrete build on real devices. These checks are pending; the deterministic test suite does not qualify hardware output, operating-system drivers, physical displays, or audio/video synchronization.

For each run, record the application version or commit, date, OS/version, device model and firmware where applicable, selected FreeShow settings, workflow, observed result, and cases not tested. Keep failures and partial runs visible.

| Workflow                                | Platform / device | Build and date | Workflow exercised | Observed result | Untested cases                                                                          |
| --------------------------------------- | ----------------- | -------------- | ------------------ | --------------- | --------------------------------------------------------------------------------------- |
| NDI video output and receiver reconnect | Pending           | Pending        | Pending            | Not run         | Receiver discovery, static and moving output, reconnect, and audio/video sync           |
| Blackmagic output                       | Pending           | Pending        | Pending            | Not run         | Card/model, display mode, pixel format, sustained output, and recovery after disconnect |
| RTMP distribution                       | Pending           | Pending        | Pending            | Not run         | Destination/network, hardware encoder, fallback, multiple destinations, and reconnect   |
| WebRTC distribution                     | Pending           | Pending        | Pending            | Not run         | Browser/platform, concurrent viewers, network interruption, and reconnect               |
| Physical presentation display           | Pending           | Pending        | Pending            | Not run         | Monitor/projector model, resolution, refresh rate, scaling, and hot-plug behavior       |
| Audio/video synchronization             | Pending           | Pending        | Pending            | Not run         | Audio interface, sample rate, output path, video target, sustained playback, and drift  |

The automated checks in `src/electron/servers.test.ts`, `src/electron/capture/helpers/CaptureTransmitter.test.ts`, and `src/electron/ndi/NdiSender.test.ts` cover selected Socket.IO delivery, capture throttling/keepalive, and the NDI sender's single pending-frame slot. They do not replace the runtime checks above.

The output-stream completion message identifies only an output id, not a frame generation. Automated tests verify one outstanding send per output id, acknowledgement isolation between ids, and reset after reconnect. They cannot prove that a delayed acknowledgement from an earlier frame will be rejected when a newer frame for that same output is outstanding.
