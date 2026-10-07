# Build Modes and Environment Variables

*[中文](./build-modes.md)*

567 Agent ships in two editions, selected by the build-time flag `AGENT567_CLOUD_ENABLED`. An unconfigured development session remains serv-less, but **packaging requires an explicit `true` or `false`** so release builds never guess their edition.

Desktop build and release settings use the `AGENT567_*` prefix, while the NewAPI endpoint and token use `API567_BASE_URL` and `API567_API_TOKEN`. The old `VETTA_*` and `NEWAPI_BASE_URL` names have been removed; builds read only the new names.

| | **open-source (no cloud services)** | **commercial (cloud services enabled)** |
| --- | --- | --- |
| Flag | `AGENT567_CLOUD_ENABLED=false` | `AGENT567_CLOUD_ENABLED=true` |
| NewAPI cloud services | ❌ not in the bundle | ✅ |
| 567 Agent Go model channel | ❌ | ✅ |
| Subscription / credits / quota | ❌ | ✅ |
| Ability marketplace source | GitHub sources (built-in official source or user-added) | Cloud marketplace; optional GitHub sources |
| Remote model catalog | ❌ | ✅ |
| Built-in skills | those without `requiresCloud` | all |

**Available in both modes**: local sessions, the coding agent, the plugin system, themes, bring-your-own-key models, the IM gateway, and the knowledge base.

Cloud and GitHub sources are independent: `AGENT567_CLOUD_ENABLED` controls cloud services only.
Both editions include the 567 Agent official GitHub marketplace, `Chinachani/567-agent-marketplace`, by default.
`AGENT567_OPEN_MARKETPLACE_REPOSITORY` replaces that built-in source with the distributor's repository. The cloud
edition does not change whether GitHub sources are available, and users can add other repositories under
Abilities → Marketplace sources.
Under Abilities → Marketplace sources, users can add multiple GitHub repositories and independently enable,
auto-update, or refresh each source. A failing source does not block others. Same-name abilities retain their
source identities; physical installation conflicts still require explicit resolution instead of silent overwrites.

`AGENT567_OPEN_MARKETPLACE_REPOSITORY` optionally declares the distribution's built-in source.
Removing it does not delete persisted sources or uninstall abilities; existing sources can be disabled in the UI.
Adding sources through the UI does not require rebuilding. Normally omit `AGENT567_OPEN_MARKETPLACE_ARCHIVE_URL`
so it follows the repository and ref. Restart development processes after editing environment files;
subsequent repository content changes only require Refresh. A GitHub commit does not publish to the cloud
marketplace. See [GitHub marketplace format](../open-marketplace.md) for source and upgrade semantics.

> `AGENT567_CLOUD_ENABLED` is a **build-time** flag, inlined as a constant and folded away: in an open-source build the cloud module and its chunks are never bundled. **It cannot be re-enabled at runtime after shipping** — switching editions requires a rebuild.

---

## Building the open-source edition

Windows, macOS, and Linux use the same entry point. It selects the host platform, disables cloud, and uses updates from the `Chinachani/567-agent` GitHub Releases page. GitHub ability sources come only from environment configuration, not script defaults.

```bash
cd apps/desktop
bun run dist:opensource
```

To create an unpacked directory for verification:

```bash
bun run dist:opensource -- --target dir
```

Forks can override GitHub and marketplace coordinates in `apps/desktop/.env.opensource`:

```bash
AGENT567_UPDATE_GITHUB_OWNER=your-org
AGENT567_UPDATE_GITHUB_REPO=your-fork
AGENT567_OPEN_MARKETPLACE_REPOSITORY=your-org/your-marketplace
```

Open-source builds reject `API567_BASE_URL`: commercial NewAPI services, the official marketplace, and the remote model catalog are absent from the bundle.

## Building the commercial edition

You need a running NewAPI service:

```bash
# apps/desktop/.env.production (local file, not committed)
AGENT567_CLOUD_ENABLED=true
API567_BASE_URL=https://api.example.com/api/v1
```

Then run `bun run dist:desktop` (or `dist:win`, `dist:mac`, or `dist:linux`) from `apps/desktop`. Commercial builds default to the `generic` provider and the official stable update feed; self-hosted deployments should explicitly override `AGENT567_UPDATE_URL`.

On Linux, `bun run package:linux` builds AppImage, DEB, and RPM together. Use `package:linux:appimage`, `package:linux:deb`, `package:linux:rpm`, or `package:linux:tar.gz` to build one format; append `:test` to the same command to use the test build environment.

On Windows, `bun run package:win` builds Inno, MSI, and ZIP together. Use `package:win:inno`, `package:win:msi`, `package:win:zip`, or `package:win:portable` to build one format; each command also has a `:test` variant. The updater manifest continues to reference only Inno; MSI and ZIP are supplemental downloads.

`API567_BASE_URL` is required for commercial builds, and production builds require HTTPS. Missing or invalid settings fail before old output is cleaned, dependencies are downloaded, or compilation begins.

---

## Environment files

No `.env.*` file is tracked in git. `apps/desktop/.env.example` is the variable index — copy it to `.env.development` and edit.

When packaging, `AGENT567_BUILD_ENV=<mode>` selects which `.env.<mode>` to load:

```bash
AGENT567_BUILD_ENV=production bun run pack     # reads .env.production
bun run pack:test                           # same as AGENT567_BUILD_ENV=test
```

Precedence: **inline on the command line > process environment > `.env.<mode>` > `.env` > code defaults**.

### Reference: a typical `.env.production`

This is what our team uses for official releases. Your production endpoint, update source and tenant are almost certainly different:

```bash
AGENT567_CLOUD_ENABLED=true
API567_BASE_URL=https://api.567.wiki/api/v1
AGENT567_UPDATE_PROVIDER=github
AGENT567_UPDATE_GITHUB_OWNER=Chinachani
AGENT567_UPDATE_GITHUB_REPO=567-agent
AGENT567_R2_BUCKET=vetta-releases
AGENT567_R2_PREFIX=desktop/stable
AGENT567_TENANT=common
AGENT567_SPEECH_INPUT_ENABLED=false
```

### Reference: a typical `.env.test`

```bash
AGENT567_CLOUD_ENABLED=true
API567_BASE_URL=http://127.0.0.1:8080/api/v1
# The default provider is stable; override AGENT567_UPDATE_URL for a dedicated test feed.
AGENT567_UPDATE_PROVIDER=generic
AGENT567_UPDATE_URL=https://updates.example.com/desktop/test
```

---

## Variable reference

### Mode and service endpoints

| Variable | Description |
| --- | --- |
| `AGENT567_CLOUD_ENABLED` | `false` produces open-source; `true` produces commercial; packaging requires an explicit value |
| `API567_BASE_URL` | Server API endpoint. Required for commercial and forbidden in open-source builds |
| `AGENT567_OPEN_MARKETPLACE_REPOSITORY` | Optional override for the built-in GitHub source; defaults to `Chinachani/567-agent-marketplace` |
| `AGENT567_OPEN_MARKETPLACE_REF` | Branch or tag, defaults to `main` |
| `AGENT567_OPEN_MARKETPLACE_ARCHIVE_URL` | Explicit archive URL; derived from repository and ref when omitted |

### Build-time trimming

| Variable | Description |
| --- | --- |
| `AGENT567_SPEECH_INPUT_ENABLED` | `false` excludes the speech models, the Sherpa native runtime and the speech entry point. Enabled by default |
| `AGENT567_TENANT` | System-plugin tenant, decides which presets get packaged. See `packages/plugins/tenants.json` |
| `AGENT567_BUILD_ENV` | Selects which `.env.<mode>` to load |

### Development toggles

| Variable | Description |
| --- | --- |
| `AGENT567_SHOW_UI_THEME` | `true` reveals the "UI theme" section in appearance settings |

### Auto-update

| Variable | Description |
| --- | --- |
| `AGENT567_UPDATE_PROVIDER` | Commercial requires `generic` (the default); open-source requires `github` |
| `AGENT567_UPDATE_URL` | For `generic`: R2, self-hosted object storage, or any static HTTP/CDN root |
| `AGENT567_UPDATE_GITHUB_OWNER` · `AGENT567_UPDATE_GITHUB_REPO` | For `github` |
| `AGENT567_R2_BUCKET` · `AGENT567_R2_PREFIX` | R2 upload target, used only by `publish:updates:r2` |

The update source is build configuration and is independent of the operating system; switching providers requires no client code changes. Platform details: [macOS](./macos-auto-update.md), [Windows](./windows-auto-update.md).

### Observability

| Variable | Description |
| --- | --- |
| `AGENT567_SENTRY_DSN` | Sentry is a no-op when unset. The DSN ends up in the bundle |
| `AGENT567_SENTRY_RELEASE` | Immutable release; must match exactly between runtime and source-map upload. Suggested: `567-agent-desktop@<version>+<build-id>` |
| `AGENT567_TELEMETRY_ENVIRONMENT` | `development` / `staging` / `production` |
| `AGENT567_SENTRY_TRACES_SAMPLE_RATE` | 0–1, defaults to 0 |
| `AGENT567_SENTRY_ORG` · `AGENT567_SENTRY_PROJECT` · `AGENT567_SENTRY_URL` | Source-map upload (CI only); `URL` is for self-hosted Sentry only |
| `AGENT567_MAIN_SOURCEMAP` | Emit a main-process source map for local stack debugging without uploading |
| `AGENT567_POSTHOG_KEY` | Project API Key (starts with `phc_`), **not** a Personal API Key. Ends up in the renderer bundle |
| `AGENT567_POSTHOG_HOST` | Defaults to PostHog Cloud US |
| `AGENT567_POSTHOG_REPLAY_ENABLED` · `AGENT567_POSTHOG_REPLAY_SAMPLE_RATE` | Replay is off by default |
| `AGENT567_TRACING` | Set to `langfuse` to trace agent / LLM / tool calls end to end |
| `AGENT567_TRACING_TRACE_NAME` · `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_BASE_URL` | Langfuse configuration |
| `LANGFUSE_TRACING_ENVIRONMENT` · `LANGFUSE_RELEASE` · `OTEL_SERVICE_NAME` | Optional metadata |

---

## Secrets

**Never put these in any `.env` file.** Inject them through the shell environment or CI secrets:

- **Cloudflare R2 upload credentials**: `AGENT567_R2_ACCOUNT_ID`, `AGENT567_R2_ACCESS_KEY_ID`, `AGENT567_R2_SECRET_ACCESS_KEY`
- **Android signing**: `AGENT567_ANDROID_KEYSTORE_BASE64`, `AGENT567_ANDROID_KEYSTORE_PASSWORD`, `AGENT567_ANDROID_KEY_ALIAS`, `AGENT567_ANDROID_KEY_PASSWORD`
- **macOS signing and notarization**: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_API_*`
  CI variants: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  Set none of them and you get an unsigned package; to sign, all of them are required. See [apple-code-signing.md](../deploy/apple-code-signing.md)
- **Sentry source-map upload**: `AGENT567_SENTRY_AUTH_TOKEN`
- **Langfuse**: `LANGFUSE_SECRET_KEY`

`AGENT567_REQUIRE_MAC_SIGNATURE=1` is only used by the macOS CI artifact verification step; it is not client configuration.

---

## CI

`.github/workflows/desktop-release.yml` resolves build configuration in the `prepare` job, which uses the `desktop-production` Environment. Precedence:

1. **Actions → desktop-release → Run workflow form** (`workflow_dispatch` only; `default` / empty means no override)
2. **Environment / repository Variables** (when the job sets `environment: desktop-production`, Environment values overlay same-named repository variables)
3. Built-in defaults: `AGENT567_RELEASE_TARGET=github` with cloud disabled, which produces an open-source GitHub Release

Both editions include the 567 Agent official GitHub marketplace by default. The
`AGENT567_OPEN_MARKETPLACE_REPOSITORY` Variable and the `marketplace_repository` input on manual runs can
override it. Users can still add other GitHub sources in the app.

**A fork with no Variables set produces an open-source build.** For the official commercial GitHub Release, set these under Settings → Environments → `desktop-production` → Environment variables:

```
AGENT567_CLOUD_ENABLED = true
API567_BASE_URL = https://api.567.wiki/api/v1
AGENT567_RELEASE_TARGET = github
AGENT567_UPDATE_URL = https://github.com/Chinachani/567-agent/releases/latest/download
```

The commercial GitHub build uses the generic updater and requires `AGENT567_UPDATE_URL`. The design library is fixed to `Chinachani/567-agent-style-library` and needs no GitHub Variable. R2 publishing requires `AGENT567_RELEASE_TARGET=r2`, `AGENT567_UPDATE_URL`, `AGENT567_R2_BUCKET`, and `AGENT567_R2_PREFIX`. The test channel is R2-only and must use isolated `desktop-test` settings, `AGENT567_UPDATE_URL_TEST`, `AGENT567_R2_PREFIX_TEST`, and R2 Secrets; it must never point at the production feed.

The form can override the edition, server URL, tenant, speech input, publish target, and channel. `AGENT567_CLOUD_ENABLED=true` works with GitHub or R2. **Do not type signing keys, R2 credentials, or DSNs into the form** — those stay in Secrets.

The release matrix waits for a dedicated quality job first: the root `bun run check`, quality-script tests, and Desktop packaging contract tests must pass before any platform build starts. Each platform then verifies updater metadata, hashes, blockmaps, and installable contents.

Matching release tags and `workflow_dispatch` runs resolved to `stable` / `test` publish through the release workflow; other manual runs keep Actions artifacts only. The current workflow releases Windows, Linux, and Android builds, and does not build macOS. It verifies desktop updater metadata and the referenced installable packages after publishing. The form is visible only after this workflow exists on the repository default branch.
