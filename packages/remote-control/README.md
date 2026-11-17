# @567agent/remote-control

Platform-neutral remote control protocol, connection lifecycle, diagnostics contract, and deterministic fake transport.

## Owns

- Versioned remote frames and runtime validation
- Request/response correlation and event sequencing
- Connection diagnostics without sensitive payload logging
- Fake transport for deterministic failure and reconnection tests

## Does not own

- Android or Electron UI
- WebSocket, Cloudflare, process, filesystem, or credential implementations
- Coding Agent execution semantics
- WebRTC screen or input transport

The language-neutral v1 contract is published in `schemas/remote-frame.schema.json` so TypeScript, Kotlin, and Worker implementations can detect protocol drift in CI.

## Development

```bash
bun run build
bun run test
```

Optional Desktop extensions include `session.results.list` (bounded task outcomes without host paths) and `session.file.transfer.finish` (explicit file delivery, matched to `purpose: "file"` at attachment-transfer start). Clients negotiate supported methods and use the existing `session.context` extension envelope for legacy relays. File delivery writes only to the session attachment directory and returns a relative path; it does not submit a prompt or grant arbitrary-path writes. Missing final acknowledgement is unconfirmed, not a successful or automatically retried transfer.
