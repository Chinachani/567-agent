# cowart-vetta (1:1 host mapping)

567 Agent bundled canvas plugin adapted from [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart).

## Desktop preset

This plugin ships with Desktop from `packages/plugins/presets/cowart-vetta`.
The entry registers sidebar and activity descriptors; launcher and panel modules load only
when opened. The tldraw editor is a further lazy chunk and is not evaluated at startup.

## Capability map (Codex → 567 Agent)

| Codex native | 567 Agent native |
|--------------|--------------|
| MCP App widget (`ui://widget/...`) | Activity tab + full **tldraw** `canvas/App.jsx` |
| `window.cowartMcp.callServerTool` | Plugin bridge → `ctx.fs` (same `project/canvas` layout) |
| `sendFollowUpMessage` | `ctx.conversation.sendPrompt` |
| Plugin-scoped MCP tools | `agent.mcpServers` + ADR-0040 (agent IO) |
| Skills | `agent.skillPaths` + slash list |

## Layout

```text
src/                 # definePlugin, CanvasPanel, vetta bridge
canvas/              # upstream App.jsx + styles/assets (tldraw UI)
mcp/ + scripts/      # agent MCP (stdio), 567 Agent-safe bundle
agent/skills/        # open / image-gen / image-edit
.mcp.json
plugin.json
```

## Build

```bash
cd packages/plugins/presets/cowart-vetta
bun install --cwd ../../../..
bun run build
```

The installable archive is written to:

```text
packages/plugins/presets/cowart-vetta/release/cowart-vetta-<version>.vettapkg
```

Install the zip from Desktop → Plugins, **restart App** if needed, open a **new conversation**.

## MCP start-mcp note

Do not `process.exit` after loading the server — `connect()` resolves when ready but the process must stay on stdio.

## Attribution

Upstream Cowart by ZHONG XIN. 567 Agent host adaptation for internal use.
