# im-gateway

`im-gateway` connects configured messaging channels to a local 567 Agent runtime. In the desktop application it runs as a bundled sidecar, managed from **Settings → IM integration**. Its lifetime follows the desktop application; users do not need to install or run the sidecar separately.

## Runtime modes

| Mode | Purpose |
| --- | --- |
| `host` | Desktop managed mode. Reads the host protocol from stdin and writes events to stdout. |
| `start`, `init`, `status`, `logs` | Standalone developer and diagnostic commands. Run `im-gateway --help` for the current command options. |

The desktop application owns configuration and credentials for bundled use. Standalone mode reads its configuration from the user's 567 Agent data directory. Do not copy production credentials into test or development profiles.

## Channel support

The repository contains transports for Feishu, Telegram, Slack, Discord, Signal, iMessage, WeChat, and WhatsApp. Which channel can be enabled depends on the current desktop build, operating system, provider setup, and channel configuration. Follow the channel-specific setup instructions under [`docs/`](docs/) and the settings shown by the application; the presence of a transport in source does not guarantee availability on every platform.

Text and attachment handling is transport-specific. Consult the corresponding transport documentation and verify platform limits before sending large files. Group behavior, message editing, and rich media support also vary by channel.

## Development

The gateway uses Go. From this directory:

```bash
go test ./...
go build ./...
```

When changing the host protocol, keep the desktop counterpart in `apps/desktop/src/main/im-host/host-protocol.ts` aligned. The runtime RPC contract is documented in [`packages/coding-agent/docs/rpc.md`](../../packages/coding-agent/docs/rpc.md).

## Related documentation

- [`docs/feishu-setup.md`](docs/feishu-setup.md)
- [`docs/troubleshooting.md`](docs/troubleshooting.md)
- [`docs/ilink-protocol.md`](docs/ilink-protocol.md)
