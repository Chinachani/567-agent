
<h1 align="center">567 Agent</h1>

<p align="center">
  An open-source desktop AI agent for real work — local-first, extensible, and under your control.
</p>

<p align="center">
  <a href="https://www.openvetta.com"><img src="https://img.shields.io/badge/upstream-openvetta.com-0b7285" alt="Open Vetta upstream website"></a>
  <a href="https://docs.openvetta.com"><img src="https://img.shields.io/badge/upstream%20docs-docs.openvetta.com-f06449" alt="Open Vetta upstream documentation"></a>
  <a href="https://discord.gg/qGqkk22Vg9"><img src="https://img.shields.io/badge/upstream-Discord-5865F2?logo=discord&logoColor=white" alt="Open Vetta upstream Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="macOS, Windows, and Linux">
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://www.openvetta.com/download">Upstream download</a> ·
  <a href="https://docs.openvetta.com/getting-started/">Upstream getting started</a> ·
  <a href="https://github.com/openvetta/open-vetta/discussions">Upstream discussions</a> ·
  <a href="https://discord.gg/qGqkk22Vg9">Upstream Discord</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

567 Agent brings models, project files, local tools, and reusable capabilities into one desktop workspace. Use it for coding, documents, data, research, creative work, and repeatable workflows without giving up control of the environment where the work happens.

It is more than a chat interface: 567 Agent can inspect a workspace, use tools with visible permission boundaries, produce real files, and keep the execution trail available for review.

## Why 567 Agent

| | What it means |
|---|---|
| **Local-first workspace** | Projects, sessions, files, and execution live in the environment you choose. |
| **Bring your own models** | Connect supported providers, OpenAI-compatible endpoints, or local inference through BYOK. |
| **Real tools and artifacts** | Work with code, documents, spreadsheets, media, commands, and generated files in one task flow. |
| **Reviewable execution** | Tool calls, plans, permissions, progress, results, and recovery paths remain visible. |
| **Reusable workflows** | Extend the agent with skills, MCP servers, plugins, themes, knowledge, batch tasks, and automation. |
| **Open client stack** | The desktop app, CLI, SDK, plugin system, themes, mobile client, and IM gateway are developed in this repository. |

## Start here

The external documentation and community links below are upstream Open Vetta references; 567 Agent's own destinations have not yet been confirmed.

| I want to… | Start with |
|---|---|
| Use the desktop app | Run it from this repository's source. The [upstream installers](https://www.openvetta.com/download) are Open Vetta releases, not 567 Agent installers. |
| Complete a real task | Follow the [first-task walkthrough](https://docs.openvetta.com/getting-started/first-task/). |
| Understand the product | Read the [product guide](https://docs.openvetta.com/product/overview/) and [security and data boundaries](https://docs.openvetta.com/reference/security-and-data/). |
| Build an extension | Choose between [skills, MCP, plugins, themes, SDK, RPC, and CLI](https://docs.openvetta.com/developers/overview/). |
| Contribute code | Read [`QUICKSTART.md`](QUICKSTART.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). |

### Run from source

Requires **Bun 1.3+** and **Node.js 20+**.

```bash
# From this repository's root directory
bun install
cd apps/desktop
bun run dev
```

The development app uses `~/.vetta-dev` by default, keeping installed-app data in `~/.vetta` untouched. Root-level `bun run dev` watches core libraries; it does not launch Electron. See [`QUICKSTART.md`](QUICKSTART.md) for the complete setup and validation commands.

## What you can do

- **Work in projects and sessions.** Keep task history, files, context, artifacts, and execution details together.
- **Use local and external tools.** Run commands, inspect files, connect MCP services, and approve sensitive operations explicitly.
- **Handle professional artifacts.** Preview and work with source code, PDF, Office files, spreadsheets, images, audio, video, SVG, and generated UI.
- **Scale a proven task.** Run the same workflow across directories with batch tasks, or schedule it as an automation.
- **Reuse organizational knowledge.** Build local knowledge bases and install reusable skills or scenarios.
- **Keep working away from the desk.** Use supported IM bridges, webhooks, notifications, quick entry, and native desktop integrations.

Upstream documentation includes task guides and screenshots: [browse upstream product capabilities](https://docs.openvetta.com/product/overview/).

## Extension model

567 Agent offers several extension levels so a simple workflow does not need to become a full plugin:

| Extension | Use it for | Guide |
|---|---|---|
| **Skill** | Teach the agent a repeatable method or domain workflow. | [Abilities](https://docs.openvetta.com/product/abilities/) |
| **MCP** | Connect external tools and data over a standard protocol. | [MCP connectors](https://docs.openvetta.com/product/mcp/) |
| **Plugin** | Extend the desktop UI, files, messages, tools, and host actions. | [Plugin development](https://docs.openvetta.com/plugins/overview/) |
| **Theme** | Replace the visual system and provide theme-specific pages. | [Theme development](https://docs.openvetta.com/themes/overview/) |
| **SDK / RPC / CLI** | Embed or drive the agent from another application or process. | [Developer paths](https://docs.openvetta.com/developers/overview/) |

### Build a plugin from any directory

You do not need this repository, or a 567 Agent source checkout, to build a plugin. Nor does an agent:

```bash
npx @vetta-org/plugin-cli init --id my-plugin --name "My Plugin"
cd my-plugin && npm install
npx vetta-plugin-cli docs        # where the manual is, and which SDK version it documents
npm run install:vetta            # build, package, install into the running desktop app
npx vetta-plugin-cli watch       # hot reload: the host loads the plugin from this directory
```

`init` also writes an `AGENTS.md`, so **any** coding agent — Claude Code, Cursor, or 567 Agent's own —
picks the project up without host-side setup. The plugin manual ships inside
`@vetta-org/plugin-sdk`, so the contract an agent reads is the contract the project compiles
against; `docs` locates it rather than anyone hard-coding a `node_modules` path.

To publish several abilities from one repository, scaffold a marketplace:

```bash
npx @vetta-org/plugin-cli init hub --name my-market \
  --repository https://github.com/me/my-market --min-app-version 0.55.0
```

That lays down the index, the `abilities/` layout, a repository-level `AGENTS.md`, and CI running
`vetta-plugin-cli sync --check`, which keeps `.vetta/marketplace.json` reconciled with each ability
package. Development commands always act on the nearest ability directory, so working inside a
marketplace is identical to working on a standalone plugin.

Plugins declare capabilities in `plugin.json`; privileged operations are authorized by the host and checked again at runtime. Plugins run inside the desktop renderer and should be treated as curated code, not as an arbitrary-code sandbox. Read the [plugin trust and permission model](https://docs.openvetta.com/plugins/manifest-and-permissions/) before distributing one.

## Data and build modes

A source checkout produces the **lite** build by default. It has no dependency on the upstream-operated backend: no account, subscription, remote administration, or hosted marketplace is required. Model requests go to the endpoint you configure, and credentials remain in local credential storage.

Upstream official installers may enable the optional Vetta Serv integration for accounts, subscriptions, and a hosted marketplace; this does not establish which services 567 Agent release builds use.

Local-first does not mean zero network traffic. Model providers, MCP servers, plugins, webhooks, IM integrations, update sources, and optional telemetry can each create their own data boundary. Review:

- [Security and data boundaries](https://docs.openvetta.com/reference/security-and-data/)
- [Configuration paths](https://docs.openvetta.com/reference/configuration-paths/)
- [Build modes and environment variables](docs/desktop/build-modes.en.md)
- [Security policy](SECURITY.md)

## Repository map

This is a Bun/TypeScript monorepo with additional Kotlin and Go applications. Dependencies point from applications toward reusable packages; `packages/*` never depend on `apps/*`.

| Area | Responsibility |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron desktop host and renderer |
| [`apps/cli-host`](apps/cli-host) | CLI host for the coding agent |
| [`apps/docs-site`](apps/docs-site) | Next.js documentation site published at `docs.openvetta.com` |
| [`apps/mobile`](apps/mobile) | Kotlin Multiplatform Android client |
| [`apps/im-gateway`](apps/im-gateway) | Go IM sidecar gateway |
| [`packages/ai`](packages/ai) · [`packages/agent`](packages/agent) | Provider abstraction and the agent loop |
| [`packages/coding-agent`](packages/coding-agent) · `packages/runtime-*` | Product composition, runtime contracts, tools, storage, MCP, and host adapters |
| [`packages/plugins`](packages/plugins) · [`packages/themes`](packages/themes) | Extension SDKs, presets, and themes |

Architecture details and public integration contracts live in the [developer documentation](https://docs.openvetta.com/developers/architecture/) and [`docs/adr/`](docs/adr/).

## Develop and contribute

Use Bun and the repository scripts; do not run bare `bun test` in this monorepo.

```bash
bun run check:quick              # changed-file lint and architecture guards
bun run check                    # full lint, types, and architecture guards
bun run test:pkg <package-name>  # focused package tests
bun run test:changed             # tests affected by the current diff
```

Pull requests target the **`dev`** branch. The contribution map, test expectations, and review bar are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Architecture and Agent collaboration rules are in [`AGENTS.md`](AGENTS.md).

Questions and early ideas belong in [GitHub Discussions](https://github.com/openvetta/open-vetta/discussions). Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/openvetta/open-vetta/security/advisories/new).

## Documentation

- [User and product guides](https://docs.openvetta.com/product/overview/)
- [Plugin development](https://docs.openvetta.com/plugins/overview/)
- [Theme development](https://docs.openvetta.com/themes/overview/)
- [SDK, RPC, CLI, and architecture](https://docs.openvetta.com/developers/overview/)
- [Troubleshooting](https://docs.openvetta.com/troubleshooting/)
- [`QUICKSTART.md`](QUICKSTART.md) for repository setup
- [`CONTRIBUTING.md`](CONTRIBUTING.md) for contributions
- [`docs/adr/`](docs/adr/) for architecture decisions

The documentation site also publishes [`llms.txt`](https://docs.openvetta.com/llms.txt), [`llms-full.txt`](https://docs.openvetta.com/llms-full.txt), and a Markdown representation of each page for Agent consumption.

## Community

The upstream Open Vetta Discord is for discussing upstream workflows, skills, and plugins; this is not an official 567 Agent community link.

<p align="center">
  <a href="https://discord.gg/qGqkk22Vg9"><img src="https://img.shields.io/badge/Open%20Vetta-Discord-5865F2?logo=discord&logoColor=white&style=for-the-badge" alt="Open Vetta Discord"></a>
</p>

**https://discord.gg/qGqkk22Vg9**

Longer, searchable threads still belong in [GitHub Discussions](https://github.com/openvetta/open-vetta/discussions), and vulnerabilities go through [GitHub Security Advisories](https://github.com/openvetta/open-vetta/security/advisories/new) — please do not report them on Discord.

## Credits and license

567 Agent is based on Open Vetta and the wider open-source ecosystem, including pi, Codex CLI, MCP, Electron, React, Bun, models.dev, and the projects listed in [`NOTICE`](NOTICE). The complete third-party inventory and original notices live there.

Licensed under [Apache-2.0](LICENSE).

- **Friends & Links:** [LINUX DO](https://linux.do/) - A Chinese community for technology enthusiasts. This project is linked with and endorsed by LINUX DO.
