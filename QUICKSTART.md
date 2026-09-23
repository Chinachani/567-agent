# Quickstart

<p align="center"><b>English</b> · <a href="QUICKSTART.zh-CN.md">简体中文</a></p>

Run 567 Agent from this repository; upstream Open Vetta installers are listed below only for reference.

## Upstream installers

Open Vetta offers installers for macOS, Windows, and Linux; these are not 567 Agent installers:

**→ [www.openvetta.com/download](https://www.openvetta.com/download)**

The installers and product guides above belong to upstream Open Vetta. This repository contains the 567 Agent source; configure your model (BYOK) and permissions when running from source.

This source checkout produces the **lite** build: no upstream Vetta login or subscription, and keys stay on your machine. Upstream installers may be **full** builds. See [Build Modes](docs/desktop/build-modes.en.md).

## Develop from source

Requires **Bun 1.3+** and **Node 20+**. macOS, Windows, and Linux are supported.

```bash
# From this repository's root directory
bun install
```

### Desktop app

```bash
cd apps/desktop
bun run dev
```

That starts the Vite renderer, the theme dev server, and Electron together. The process uses `~/.vetta-dev`, so your installed-app data in `~/.vetta` is left alone.

| Command | Data root | When to use it |
|---|---|---|
| `bun run dev` | `~/.vetta-dev` | Default sandbox |
| `bun run dev:home` | `~/.vetta` | You want the dev build to read and write real user data |

`bun run dev` **at the repository root** only watches core libraries. It does not launch the app.

### Documentation site

```bash
bun run --cwd apps/docs-site dev
```

Opens on `http://127.0.0.1:4321`. Public docs live in `apps/docs-site/content/docs/`.

### Checks you will actually run

```bash
bun run check:quick        # Biome + architecture guards on changed files
bun run check              # lint + types + guards, before a PR
bun run test:pkg ai        # one package; `bun run test:pkg --list` shows names
```

Do not run bare `bun test`. On Windows it is the wrong runner; use `bun scripts/quality/run-vitest.mjs --run <file>` or `bun run test:pkg`.

Packaging, environment variables, and the lite/full flag: [Build Modes](docs/desktop/build-modes.en.md). Contribution map and PR bar: [CONTRIBUTING.md](CONTRIBUTING.md).
