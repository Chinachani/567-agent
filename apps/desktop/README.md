# @567agent/desktop

Electron desktop host for the 567 Agent runtime.

## What It Owns

- Electron main/preload/renderer wiring
- desktop-specific IPC bridges
- file explorer, scheduler, project, and chat renderer domains
- integration of runtime packages into a desktop shell

## What It Does Not Own

- provider protocol implementations
- core agent loop logic
- business backend rules

## Who Depends On It

- end users running the desktop application

## Internal Boundaries

- `src/main`: Electron main process and native capabilities
- `src/preload`: safe bridge surface for the renderer
- `src/renderer`: React application domains and UI

## Experts and project collaboration

The agent center has two sections: Experts and Session collaboration.
The built-in planning, development, research, review, and solution experts each include a prompt,
working steps, deliverables, and limits. Workflow previews come from the same prompt used by the
model. Choose **Use** to open an ordinary conversation draft; only sending the first message creates
the conversation and calls the model.

Built-in profiles are read only. **Copy and customize** opens an unsaved draft with the effective
prompt and current enabled abilities copied into an independent selection. Save it, or choose
**Save and use**. Later edits to the source do not replace the copied prompt; unavailable or disabled
abilities remain subject to normal runtime validation and permissions. If the source disappears
while copying, the draft stays open and saving reports that the source is unavailable.

For multiple experts, open a project's existing Session collaboration page, create expert
conversations for that project, then add them as members after their first message. Responsibilities,
read/write access, and coordination use the existing project collaboration controls. Save pending
project rules and collaboration changes before following the expert shortcut.

Experts can be searched by name, description, or workflow, and filtered by specialty. Known built-in
identities and their copies keep the planning/development/research/review/solution categories; other
local profiles appear under Custom and other plugin profiles under Extension experts. Project
collaboration entries can be searched by name or path. Both center lists use 12 items per page.
Inside a project, candidates and task records use independent searches and 8-item pages. Task search
includes source/target sessions, status, and results. Filtering does not remove draft members or limit
project-wide pause/stop operations. Changing project resets the list state.

The old team workspace and settings UI are removed. Sidebar history entries and conversation/member
deep links open the ordinary read-only viewer, with an explicit action to stop an in-flight legacy task.
Archive resolution reads persisted records without restoring team runtimes or recovering queued work.
Old list/settings/new links open Session collaboration. Definitions, files, and stored model preferences
are preserved; no automatic data deletion or conversion takes place. If an ancient archive cannot be
resolved to an ordinary conversation path, the resolver explains this and offers retry.

A separate GitHub repository can distribute expert presets through existing marketplace sources. Source-only
presets are shown directly in Agent Center; capability installation remains a separate, user-approved path.
See the [preset marketplace repository guide](../../docs/expert-preset-marketplace.md). No remote
repository or new source has been configured by this change.
See [ADR-0162](../../docs/adr/0162-experts-and-project-session-collaboration.md).

## SSH projects, automation and connectors

The 1.6 development tree exposes SSH hosts in Settings and remote directories through the project picker. Hosts can be imported from SSH config or entered manually, with key/password authentication. `ssh-hosts.json` is a versioned document separate from Desktop preferences; secrets remain in the credential store. Remote file access and runtime operations use the SSH transport/helper boundary, and host identity or authentication prompts are not bypassed. No live remote host is required for compilation.

Automation uses structured schedules and explicit new-session/same-session targets. The first load backs up and migrates legacy task storage. Missing projects, deleted target sessions and retired scene selections suspend affected tasks; history stays readable. New sessions inherit the user's configured execution mode, while continuing a session does not elevate its permissions. Missed and skipped records distinguish unavailable execution from completed work. Legacy plugin cron requests are converted at the facade; direct capability callers use the new schema.

MCP supports global/project scope, SSE and read-only discovery of project `.mcp.json`. Project discovery does not approve server execution. The existing manual approval and credential redaction boundaries still apply.

## Models and extension surfaces

Model configuration keeps the 567 API / preset / local provider tabs and their independent parameter lists. A shared default-model selector above them supports reasoning levels, search and favorites. New conversations and windows use the configured default rather than the last model selected in another conversation. Image-generation catalogs remain separate from chat model choices.

Plugin SDK 0.3.10 / Plugin API 2.9 provide header actions, bottom panels, authorized terminal entry points, shared ModelPicker, filesystem filtering/watch and user-confirmed save-as. See the [plugin manual](../../docs/plugin/README.md) for permission and compatibility contracts. Public SDK version changes do not publish npm packages automatically.

## Windows updates

After an update finishes downloading, the app shows a local preparation stage while Inno Setup
unpacks and validates the new version. Disk activity can remain high during this stage; the progress
bar stays busy and restart becomes available only when preparation finishes. Background updates do
not migrate the data directory. Manual installation can copy data when changing its location and
keeps the original directory.

New Windows launchers include the 567 Agent icon. Packaged Windows launches also refresh the icon
of existing app-owned desktop and per-user Start Menu shortcuts, preserving their targets and
arguments. Deleted, renamed, shared, or unrelated shortcuts are not recreated or changed.

## File and update downloads

File downloads and full update packages share one bounded HTTP Range transport. At most two file
jobs run at once with up to four segments each. Strong ETags protect file resume; sources without a
reliable validator or range support use a single stream. Pausing retains the queue slot until old
requests and file handles stop. Download headers stay in memory with their own task and are stripped
on cross-origin redirects. Newly downloaded files never replace an independently created destination.
Retries without a validator restart the file so content from different versions cannot be combined.
Legacy partial files at their final path are preserved and resumed jobs restart at a free filename.

Electron/Chromium keeps system proxy handling, with an isolated cookie-free download session.
Repeated redirect discovery is cached briefly per URL and request-header identity. Full updates still
require the official checksum and retain electron-updater's differential and installation pipeline.

## Remote tablet input

Linux remote desktop capture runs in a separate Electron process so a native capture crash
does not terminate the main application. Screen approval and input permissions remain owned
by the main process. After an abnormal capture exit, one recovery is allowed within five minutes
and screen sharing needs approval again. A second exit stops automatic recovery; stopping and
restarting the remote host starts a new recovery cycle. Normal network reconnects retain the
existing capture. The helper uses a disposable profile in the `remote-capture` application cache
namespace and exits when its parent IPC disconnects. See [ADR-0161](../../docs/adr/0161-linux-remote-capture-process-isolation.md).

The mobile fullscreen input selector offers tablet taps and a trackpad. Wayland direct taps require
an identified whole primary monitor plus a matching monitor returned by the user-authorized desktop
portal. Unknown/window sources remain in trackpad mode; changing display geometry revokes the old
mapping. No input permission is requested or granted by merely selecting a phone-side input mode.

## Windows Voice Input

Local streaming voice input is currently available only on Windows x64. The Windows artifact includes
`sherpa-onnx-win-x64`; macOS and Linux artifacts exclude that native package. The pinned Chinese
Zipformer model is downloaded and verified during a Windows build, then included under
`Resources/speech-models/` in the packaged application. Runtime voice input is fully offline and never
downloads model files. Build machines reuse verified files in `resources/speech-models/`; delete that
gitignored directory to force a fresh download.

The renderer captures 16 kHz mono PCM with an AudioWorklet. Recognition runs in a dedicated Electron
utility process so native initialization and decoding do not block the main process. See
[`ADR-0070`](../../docs/adr/0070-windows-local-streaming-speech-input.md).

Windows speech input is enabled in builds by default. Set `AGENT567_SPEECH_INPUT_ENABLED=false` before
running the complete build or packaging command to produce an artifact without the speech model,
Sherpa native runtime, speech utility-process entry, microphone permission, or Renderer microphone entry:

```powershell
$env:AGENT567_SPEECH_INPUT_ENABLED="false"
bun run dist:opensource
```

The value is a build-time contract and must be exactly `true` or `false`; it cannot be changed after
packaging. Disabled builds keep any verified model in the ignored build cache for later reuse, but do
not copy it into the staged application.

Run `bun run prepare:speech-models` to prepare the production model explicitly, or
`bun run prepare:speech-models:dev` to use `.env.development`. The production command skips
macOS/Linux targets, and is also part of `bun run build` and revalidated by `prepare-pack.js` before
a Windows artifact is staged. After `bun run build:main`, run `bun run verify:speech-host` to
exercise the real Electron utility process with the bundled Sherpa runtime and model through
initialize, start, audio, and stop.

## Service routes

Login, the account popover, and model settings share a compact route selector. The selectable route list is refreshed anonymously from `https://api.567.wiki/api/status` (`data.api_info`). Cached routes render immediately; an empty/invalid response or offline bootstrap preserves the last valid catalog and selected route. A manual refresh is available. The public list is separate from the root-only system-instance monitoring API. Connectivity checks use the public status API; switching also validates the current account. New installations use mainland, while upgrades retain their original route. Existing turns keep their original route and future turns use the new one, including Electron RPC/Claw sessions. Custom provider URLs are not rewritten.

## Development

`bun run test:sidebar-layout` renders the real account summary and production CSS in an isolated
Electron window. It checks four sidebar widths in light and dark mode and opens the account popover,
without loading a user profile. Linux requires Xvfb; use `AGENT567_TEST_XVFB` to select its binary.
This probe also runs in the Linux regression job when the account layout or its CSS changes.

### Sidebar conversation search

Use the search button in the sidebar's top action row to open the floating panel. It searches titles,
user messages, and Agent text replies across regular conversations, Claw records, project sessions,
and registered batch projects. Only text blocks are included: tool calls (including names and arguments),
tool results, thinking, and non-text attachments are excluded. A reply containing both text and tool calls
still contributes its text blocks. Type, project, and time filters default to all; archived projects are excluded. Results open
with the session's existing interactive/read-only access rules. Pinning is a local UI preference and
keeps conversations at the top of their existing sidebar group.

Each result shows one source label on the right: the project name for project/batch sessions, or the
conversation type for regular conversations and Claw. The pin button sits immediately to its left in
the title row, leaving the excerpt the full row width. Pinning never opens the conversation; both
actions can be reached separately with the keyboard. Long titles and source names are truncated
visually but remain available in the row's accessible name and hover text.

The filter icon beside the shared `Input` expands the type/project/time controls on demand. Active filters
remain visible as removable chips with a count on the icon, even while the controls are collapsed.
Resetting filters keeps the query; removing filters or clearing the query returns focus to the search
input. Expanding/collapsing controls does not restart the search. Closing the panel restores the
default unfiltered, collapsed state for its next opening.

Time filters use the catalog's last-message activity time, not the timestamp of the matching message.
Older or empty records without a usable message time retain the catalog's existing file-time fallback.
Presets include Today, Last 7 days, Last 30 days, and This month; day counts include today and use the
local calendar/timezone. Custom dates accept either or both endpoints, including the entire end day.
Custom endpoints use the shared shadcn-style `DatePicker` (`Popover` + `Calendar`/React DayPicker), not
native date inputs. Month/year menus use the shared `Select`; the year menu is a bounded sliding window.
Each endpoint supports Today, clearing and keyboard selection. Dates beyond the other endpoint are disabled;
Escape closes only the innermost menu/calendar and returns focus to its trigger. Tokens, Solar icons and
1px inset focus rings follow the desktop design system.
Incomplete or reversed ranges show an inline explanation and pause searches until corrected.
Date bounds are validated again in Main and applied in the worker before matching titles or reading bodies.

Search results always sort newest first, regardless of hit type, source, or pin status, and show their
last-message time. Equal timestamps use a stable path tie-breaker. Sidebar groups retain pin-first ordering.
Each partial result batch is merged by path, sorted, and capped: newer matches discovered later replace
older entries. Reaching the cap does not stop metadata discovery or exclude newer body matches.

Titles and excerpts highlight the literal query, ignoring case, compatibility-width differences, and
repeated whitespace while preserving the original text. Excerpts stay centered on a match, including
for long titles and queries. Before the first hit, the panel shows a central loading explanation;
once hits arrive, a visible progress strip stays above the scrollable list so results can be opened
while the search continues. Empty results and read failures have distinct states.

Search is debounced and cancellable. A lazily started worker reuses the runtime's native and historical
file readers; no history files are migrated or rewritten, and no search data is sent to a server. Hits
are displayed as they arrive, with titles checked before message bodies. Each query retains at most 100
conversations at a time and asks users to narrow the filters when that limit is reached; incremental
updates can replace older matches. Bodies too old to enter the result window are not parsed. The searchable-text LRU cache
retains at most 16 million UTF-16 code units (roughly 32 MiB of text), excluding object overhead; metadata
is capped at 10,000 sessions. The worker is released after one minute idle. First searches still need to
discover local history; a very large individual file is parsed in the worker, not on the UI/main thread.

## Development workflow

### Agent configuration and observability

Each conversation owns its Agent instance. Agent configuration remains a host/Runtime capability: callers can supply a
versioned template snapshot and session overrides, inspect desired/effective revisions, and update them for the next Turn.
Desktop does not expose an Agent configuration editor, template CRUD, or a Trace panel in conversation UI, preload or
dedicated IPC. Existing model and work-mode controls are unchanged. Saved session configuration still restores from its
embedded snapshot; legacy `agent-templates.json` is left untouched and is no longer used by Desktop.
See the [configuration API](../../packages/coding-agent/docs/agent-configuration.md).

`src/main/agent-observability` composes local diagnostic storage and optional remote export under the existing Runtime
Observation Hub. Trace/span remains the native execution signal within observability; identity, configuration revisions,
usage and parent linkage are preserved without collecting content. The Runtime composition owns and closes these resources.
Internal queries remain session-scoped; no global UI query singleton or diagnostic IPC remains. The v1 `agent-traces.json`
path and retention limits (7 days, 5,000 records, 16 MiB) stay compatible. Degradation is reported through safe structured logs
and internal query health. Remote export still requires explicit `AGENT567_TRACING=langfuse` configuration.

### Local development

Run `bun dev` from this package after installing the monorepo dependencies. The development startup
uses the root Turborepo task graph and local cache to build changed workspace prerequisites, stages
plugin and theme manifests, then starts the renderer, theme server, and Electron process in parallel.

Normal development is isolated from packaged application data: it defaults to
`AGENT567_CONFIG_DIR=.567agent-dev` and stores the Chromium profile under
`~/.567agent-dev/electron-user-data`. Packaged builds use `~/.567agent`. Set
`AGENT567_CONFIG_DIR` and `AGENT567_DESKTOP_USER_DATA_DIR` together when a custom isolated development
environment is required.

Because the Chromium profile is derived from the config directory, switching `AGENT567_CONFIG_DIR`
switches the whole environment — data root and browser profile — with no shared state between them.
Two scripts make the common pair explicit:

```bash
bun run dev:isolated   # ~/.567agent-dev (same as `bun dev`)
bun run dev:installed-data # ~/.567agent (installed-app data)
```

Saved credentials are shared too: `safeStorage` derives its master key from the Electron app name, so
that name is fixed by `src/shared/app-identity.ts` and must stay equal to the name written into the
packaged `package.json` by `scripts/prepare-pack.js`. Changing it strands every credential already
encrypted under the old name.

`bun run dev:installed-data` selects the same `~/.567agent` data root as packaged builds.
The first normal launch migrates an existing `~/.567agent` data directory into `~/.567agent`.
Do not run two processes against the same config directory at once: they share the Chromium profile
and single-instance lock. The project-level `<cwd>/.vetta` directory remains a compatibility path and
does not follow `AGENT567_CONFIG_DIR` (see `packages/coding-agent/src/config.ts`).

Set `AGENT567_CONFIG_DIR` on the command line, not in `.env.development`: the dev launcher is plain
Node and never reads `.env` files, so a value placed there would only reach the vite-inlined main
process and would disagree with the launcher-derived Chromium profile.

Main-process sourcemaps are disabled by default to keep startup builds fast. Set
`AGENT567_MAIN_SOURCEMAP=true` when source-mapped Electron stack traces are needed.

Persistent Renderer logs keep user-operation signals, warnings, and errors by default, while omitting
high-frequency plugin registration, activity-tab resolution, theme loading, and routine Vite HMR records.
DevTools still shows those console messages. Set `AGENT567_RENDERER_VERBOSE_LOGS=1` before starting Desktop
when a diagnostic session needs the complete Renderer console stream in the log files.

Route errors offer a page retry and an explicit interface reload. React retains failed lazy page
imports, and module evaluation failures may also be cached by the browser. Their recovery action
reloads the document instead of only resetting the error boundary. Reloading is never automatic and may
discard unsent input or unsaved changes. If it still fails, quit and reopen Desktop. Route logs
include the page module name and original exception to distinguish import failures from rendering errors.

Development automatically starts plugin dev servers for every preset selected by the active
`AGENT567_TENANT`, so preset source, manifest, locale, and agent resource changes reload without an
App restart. Set `AGENT567_PLUGIN_DEV` to a comma-separated list to limit development to specific
plugins, or set it to an empty string to disable plugin dev servers and use staged archives only.
Each project uses its own exported `@vetta-org/plugin-vite/cli`. The stable staged or installed
plugin remains active until the development server completes its versioned ready handshake; an
unexpected server exit rolls back that overlay before bounded restart attempts.

## Electron E2E (WebdriverIO)

Uses WebdriverIO + `@wdio/electron-service` (see `wdio.conf.ts`, `e2e/`).

```bash
# 1) Build main / preload / renderer artifacts
bun run build

# 2) Unpackaged smoke (default: dist/main/index.js)
bun run test:e2e

# Or smoke against an open-source electron-builder unpacked binary
bun run dist:opensource -- --target dir
bun run test:e2e:packaged
```

Runtime sets `AGENT567_E2E=1`, `AGENT567_CONFIG_DIR=.vetta-e2e`, and isolates Chromium profile under `.wdio-electron-user-data`.
When a user explicitly requests agent-driven UI verification, use repo-root `verify:ui:*` (Playwright); UI changes alone do not trigger it. This WebdriverIO suite targets formal E2E / CI.

Current `e2e/smoke.e2e.ts` batch-1 covers boot only: main-process ready/version, main window `index.html`, config/userData isolation, and a `dialog` mock probe. It does not cover login, chat, or other product flows.

Packaged E2E permits one immediate spec-file retry. WebdriverIO creates a fresh browser instance for the retry, which recovers the upstream CDP bridge when its initialization promise is transiently collected during a packaged process. Unpackaged E2E does not retry; assertions are unchanged and a second failure remains fatal.

### Workspace layout regression

`bun run test:workspace-layout` renders the production home/composer, automation templates and populated
tasks, batch tasks, abilities, scenes, knowledge base and settings chrome in an isolated Electron profile.
It checks light/dark modes at 380/800/1100px and exercises model selection, text input, attachment,
send, template and creation controls against fixture callbacks. HTTP(S) access is blocked.
`AGENT567_LAYOUT_ARTIFACT_DIR` saves screenshots and measurements. It complements `test:sidebar-layout`,
which covers the real footer, titlebar commands, general settings, providers and guide focus/scrolling.

## 专家预设来源

「智能体 → 专家」读取内置专家及 `Chinachani/567-agent-presets` 中经过校验的纯提示词预设，
无需先安装插件。专家页可刷新并查看缓存或失败状态；网络失败保留上次有效内容。
「能力 → 市场来源」仍统一管理来源配置，但专家条目不作为普通能力安装。
使用专家只填写会话草稿；复制出的提示词和能力选择独立保存。格式与边界见
[专家预设仓库](../../docs/expert-preset-marketplace.md)。

### 任务准备、交接与结果

智能体中心支持收藏和最近打开；专家的任务准备表单将目标、材料、约束与交付要求追加到现有草稿。会话顶栏的专家交接可选择性带入最近完整回复的文字，补充待办后打开下一位专家的新会话草稿，均由用户发送后才执行。消息中心「任务结果」从持久化会话请求读取终态，支持打开原会话与本机已读；未知状态不会推断为成功，独立后台工具任务仍通过原入口查看。

手机可向电脑会话的附件目录独立传文件，不触发模型；主机选择保存文件名并返回相对路径，不开放任意路径写入。支持自动／流畅／清晰远控画质偏好，旧手机和电脑继续原有默认行为。
