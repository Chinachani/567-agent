# @567agent/remote-desktop

Platform-neutral contracts and browser WebRTC orchestration for 567 Agent screen viewing and remote input.

This package is deliberately separate from `@567agent/remote-control`: chat/session traffic remains replayable request/event protocol traffic, while desktop media uses WebRTC and input uses an ordered DataChannel.

Relay-backed hosts start with `waitForPeerReady: true`. The relay emits the validated, relay-owned `peer_ready` event only after both signaling sockets are online; the host then creates its offer. This prevents the one-shot offer from being lost when the Desktop starts before the mobile viewer.

Hosts can advertise `pointerMode: "relative"` in the input-channel capabilities. Updated viewers then send bounded `pointer.relative` deltas; older hosts keep the existing normalized absolute-pointer contract. OS input grants remain owned by the host, and the capability does not grant authority. Hosts may set `inputEnabled: false` on creation and call `setInputEnabled()` after consent or revocation. Each change sends the current permission in the capabilities message and stops forwarding input immediately; omitted `inputEnabled` retains the legacy host behavior. Updated mobile viewers display read-only state until granted.

## Verification

```bash
bun run build
bun run test
bun run test:e2e
```

The E2E launches real Electron Chromium, captures an animated canvas, sends it through an actual `RTCPeerConnection`, checks that the viewer receives nonblank changing pixels, and sends a validated pointer event back through the DataChannel.

## Adaptive video

Hosts hint a 4 Mbps initial estimate and cap video at 12 Mbps/30 FPS. The sender samples encoder
pressure, reduces oversized software-encoded frames, and cautiously recovers resolution. Codec
preferences retain browser fallbacks; OS capture consent and input grants are unchanged.

Updated hosts advertise optional `viewport: true` on the existing input channel. A viewer may then
send `{type:"viewport", sequence, width, height}` (positive integral dimensions up to 8192). These
messages have independent replay protection and only tune video; they are never forwarded to input
injection. Updated Android viewers wait for this capability; legacy peers continue without feedback.
The browser viewer exposes `supportsViewport` and `sendViewport(width, height)` for the same contract.
