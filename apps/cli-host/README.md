# @567agent/cli-host

CLI and process composition roots around `@567agent/coding-agent`.

## What It Owns

- process entrypoint for the CLI app
- the `567-agent` and `567-agent-rpc` executable entrypoints (legacy `vetta*` aliases remain available)
- host-profile selection for Print, RPC, and IM RPC execution
- dedicated JSONL RPC sidecar entrypoint
- Node RPC Client and child-process lifecycle
- argument handoff into `coding-agent`

## Runtime Entry

All Agent commands use the single production runtime. IM capabilities are enabled by the host profile rather than a runtime selector:

```text
567-agent-rpc --mode rpc \
  --enable-host-bridge \
  --scenario im-claw \
  --session-dir <conversation-directory>
```

The dedicated RPC entry keeps stdout reserved for JSONL protocol frames; startup diagnostics use stderr. Historical
session files remain readable through the explicit pre-open import boundary, but they do not select a different runtime.

## What It Does Not Own

- agent behavior
- model/provider logic
- terminal UI primitives
- RPC wire semantics, validation, and command dispatch

## Who Depends On It

- shell users and packaging targets that want a dedicated CLI package

Desktop 嵌入 `runAgentRuntimeCli` 时可通过可选的 `streamFn` 注入宿主模型传输。该函数经 Runtime 组合口用于 RPC、IM 和 print 的模型调用；默认 CLI 继续使用内置流式传输，宿主负责其专用请求鉴权。
