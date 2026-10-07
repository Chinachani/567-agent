# 构建模式与环境变量

*[English](./build-modes.en.md)*

567 Agent 有两种发行形态，由构建期开关 `AGENT567_CLOUD_ENABLED` 决定。开发启动时未配置仍按 serv-less 运行；**正式打包必须显式选择 `true` 或 `false`**，前置检查不会再猜测版本类型。

桌面构建与发布配置统一使用 `AGENT567_*` 前缀；NewAPI 地址和令牌使用 `API567_BASE_URL`、`API567_API_TOKEN`。旧 `VETTA_*` 与 `NEWAPI_BASE_URL` 名称已移除，构建只读取新名称。

| | **开源版（无云服务）** | **商业版（含云服务）** |
| --- | --- | --- |
| 开关 | `AGENT567_CLOUD_ENABLED=false` | `AGENT567_CLOUD_ENABLED=true` |
| NewAPI 云服务 | ❌ 代码不进产物 | ✅ |
| 567 Agent Go 模型渠道 | ❌ | ✅ |
| 订阅 / 积分 / 配额 | ❌ | ✅ |
| 能力广场来源 | GitHub 多源（内置官方源或用户添加） | 云市场；可选 GitHub 多源 |
| 远程模型目录下发 | ❌ | ✅ |
| 内置技能 | 不含 `requiresCloud` 标记的 | 全部 |

**两种模式共有**：本地会话、编码 Agent、插件系统、主题、自带 API Key 的模型、IM 旁路、知识库。

云市场与 GitHub 来源相互独立：`AGENT567_CLOUD_ENABLED` 只控制云服务，不启停 GitHub 来源。
两种版本均内置 567 Agent 官方 GitHub 能力市场 `Chinachani/567-agent-marketplace`；
`AGENT567_OPEN_MARKETPLACE_REPOSITORY` 可将内置来源替换为发行方自己的仓库。云版与开源版的区别不影响
GitHub 来源是否可用，用户也可以在「能力 → 市场来源」中添加其他仓库。
用户可在「能力 → 市场来源」管理多个 GitHub 仓库，分别启停、自动更新或手动刷新；单源失败不阻断其他来源。
同名能力保留来源身份，实际安装冲突仍需显式处理，不会静默覆盖。

`AGENT567_OPEN_MARKETPLACE_REPOSITORY` 用于声明发行版的内置默认仓库；日常添加来源使用界面，无须重新构建。
移除环境配置不会删除已经保存的来源，也不会卸载能力；已有来源可在界面停用。
默认省略 `AGENT567_OPEN_MARKETPLACE_ARCHIVE_URL`，让它从仓库与分支推导。
修改环境文件后须重启开发进程（仅刷新页面无效）；之后仓库内容更新只需点击刷新。
GitHub 提交不会自动发布到云市场。来源与升级语义见 [GitHub 能力市场](../open-marketplace.md)。

> `AGENT567_CLOUD_ENABLED` 是**构建期**开关，经常量折叠写死进产物：开源版里 cloud 模块连同它的 chunk 都不会被打包。**发包之后无法由运行环境重新开启**，切换必须重新构建。

---

## 开源版构建

Windows、macOS、Linux 使用同一个入口；脚本按当前宿主选择平台，关闭 cloud，并通过 `Chinachani/567-agent` 的 GitHub Releases 更新。GitHub 能力来源仅取环境配置，不由脚本自动补充。

```bash
cd apps/desktop
bun run dist:opensource
```

需要只生成解压目录用于验证时：

```bash
bun run dist:opensource -- --target dir
```

fork 可在 `apps/desktop/.env.opensource` 覆盖 GitHub 仓库和 Marketplace 坐标；版本类型与 provider 不能覆盖：

```bash
AGENT567_UPDATE_GITHUB_OWNER=your-org
AGENT567_UPDATE_GITHUB_REPO=your-fork
AGENT567_OPEN_MARKETPLACE_REPOSITORY=your-org/your-marketplace
```

开源版**不接受** `API567_BASE_URL`——商业版 NewAPI 服务、官方市场与远程模型目录都不在产物里。

## 商业版构建

需要一个可用的 NewAPI 服务端：

```bash
# apps/desktop/.env.production（本地文件，不提交）
AGENT567_CLOUD_ENABLED=true
API567_BASE_URL=https://api.example.com/api/v1
```

然后在 `apps/desktop` 执行 `bun run dist:desktop`（或对应的 `dist:win` / `dist:mac` / `dist:linux`）。商业版默认使用 `generic` provider 和官方 stable 更新源；自有部署应显式覆盖 `AGENT567_UPDATE_URL`。

Linux 可以用 `bun run package:linux` 一次生成 AppImage、DEB 和 RPM，也可以用 `package:linux:appimage`、`package:linux:deb`、`package:linux:rpm` 或 `package:linux:tar.gz` 只生成一种格式；相同命令追加 `:test` 即读取测试构建环境。

Windows 可以用 `bun run package:win` 一次生成 Inno、MSI 和 ZIP，也可以用 `package:win:inno`、`package:win:msi`、`package:win:zip` 或 `package:win:portable` 只生成一种格式；这些命令同样提供 `:test` 变体。自动更新清单只引用 Inno，MSI/ZIP 作为额外下载格式发布。

`API567_BASE_URL` 在商业版下是必填的，生产构建还要求 HTTPS。缺失或非法配置会在清理旧产物、下载依赖和编译之前一次性报出。

---

## 环境变量文件

`.env.*` 一律不纳入版本控制。`apps/desktop/.env.example` 是变量索引，复制成 `.env.development` 后按需修改。

打包时用 `AGENT567_BUILD_ENV=<mode>` 指定加载哪个 `.env.<mode>`：

```bash
AGENT567_BUILD_ENV=production bun run pack     # 读 .env.production
bun run pack:test                           # 等价于 AGENT567_BUILD_ENV=test
```

优先级：**命令行内联 > 进程环境变量 > `.env.<mode>` > `.env` > 代码默认值**。

### 参考：典型的 `.env.production`

本团队官方发版用的配置，供参考——你的生产端点、更新源、租户大概率不同：

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

### 参考：典型的 `.env.test`

```bash
AGENT567_CLOUD_ENABLED=true
API567_BASE_URL=http://127.0.0.1:8080/api/v1
# 未配置 provider 时默认使用 stable 更新源；测试专用地址可显式覆盖 AGENT567_UPDATE_URL。
AGENT567_UPDATE_PROVIDER=generic
AGENT567_UPDATE_URL=https://updates.example.com/desktop/test
```

---

## 变量参考

### 模式与服务地址

| 变量 | 说明 |
| --- | --- |
| `AGENT567_CLOUD_ENABLED` | `false` 产出开源版，`true` 产出商业版；正式打包必须显式填写 |
| `API567_BASE_URL` | 服务端 API 端点。商业版必填，开源版禁止设置 |
| `AGENT567_OPEN_MARKETPLACE_REPOSITORY` | 可选覆盖内置 GitHub 源；缺省使用 `Chinachani/567-agent-marketplace` |
| `AGENT567_OPEN_MARKETPLACE_REF` | 分支或标签，缺省 `main` |
| `AGENT567_OPEN_MARKETPLACE_ARCHIVE_URL` | 直接指定归档地址，省略时由仓库与 REF 推导 |

### 构建期裁剪

| 变量 | 说明 |
| --- | --- |
| `AGENT567_SPEECH_INPUT_ENABLED` | `false` 时不打包语音模型、Sherpa 原生运行时与语音入口。缺省开启 |
| `AGENT567_TENANT` | 系统插件租户，决定打包哪些 preset 插件。取值见 `packages/plugins/tenants.json` |
| `AGENT567_BUILD_ENV` | 指定加载哪个 `.env.<mode>` |

### 开发期开关

| 变量 | 说明 |
| --- | --- |
| `AGENT567_SHOW_UI_THEME` | `true` 时在外观设置里显示「界面主题」区段 |

### 自动更新

| 变量 | 说明 |
| --- | --- |
| `AGENT567_UPDATE_PROVIDER` | 商业版必须为 `generic`（缺省即此值）；开源版必须为 `github` |
| `AGENT567_UPDATE_URL` | `generic` 用，适用于 R2、自建对象存储或任意静态 HTTP/CDN 根路径 |
| `AGENT567_UPDATE_GITHUB_OWNER` · `AGENT567_UPDATE_GITHUB_REPO` | `github` 用 |
| `AGENT567_R2_BUCKET` · `AGENT567_R2_PREFIX` | R2 上传目标，仅 `publish:updates:r2` 使用 |

更新源是构建配置，与操作系统无关；切换 provider 无需修改客户端代码。平台细节见 [macOS](./macos-auto-update.md) 与 [Windows](./windows-auto-update.md)。

### 可观测性

| 变量 | 说明 |
| --- | --- |
| `AGENT567_SENTRY_DSN` | 未配置时 Sentry 为 Noop。DSN 会进入构建产物 |
| `AGENT567_SENTRY_RELEASE` | 不可变 release，运行时与 Source Map 上传必须一致。推荐 `567-agent-desktop@<version>+<build-id>` |
| `AGENT567_TELEMETRY_ENVIRONMENT` | `development` / `staging` / `production` |
| `AGENT567_SENTRY_TRACES_SAMPLE_RATE` | 0～1，缺省 0 |
| `AGENT567_SENTRY_ORG` · `AGENT567_SENTRY_PROJECT` · `AGENT567_SENTRY_URL` | Source Map 上传（仅 CI），`URL` 仅自托管需要 |
| `AGENT567_MAIN_SOURCEMAP` | 仅本地调试 Main 堆栈时单独生成 Source Map |
| `AGENT567_POSTHOG_KEY` | Project API Key（`phc_` 开头），**不是** Personal API Key。会进入 Renderer 产物 |
| `AGENT567_POSTHOG_HOST` | 缺省 PostHog Cloud US |
| `AGENT567_POSTHOG_REPLAY_ENABLED` · `AGENT567_POSTHOG_REPLAY_SAMPLE_RATE` | Replay 默认关闭 |
| `AGENT567_TRACING` | 设为 `langfuse` 开启 Agent / LLM / 工具调用全链路 trace |
| `AGENT567_TRACING_TRACE_NAME` · `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_BASE_URL` | Langfuse 配置；Trace 名称建议使用 `567 Agent` |
| `LANGFUSE_TRACING_ENVIRONMENT` · `LANGFUSE_RELEASE` · `OTEL_SERVICE_NAME` | 可选元数据 |

---

## 机密变量

**以下变量不要写入任何 `.env` 文件**，只通过 shell 环境或 CI Secret 注入：

- **Cloudflare R2 上传凭据**：`AGENT567_R2_ACCOUNT_ID`、`AGENT567_R2_ACCESS_KEY_ID`、`AGENT567_R2_SECRET_ACCESS_KEY`
- **Android 签名**：`AGENT567_ANDROID_KEYSTORE_BASE64`、`AGENT567_ANDROID_KEYSTORE_PASSWORD`、`AGENT567_ANDROID_KEY_ALIAS`、`AGENT567_ANDROID_KEY_PASSWORD`
- **macOS 签名与公证**：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_API_*`
  CI 变体：`MACOS_CERTIFICATE_P12_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY_P8_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
  一个都不设则产出未签名包；要签名则必须全部齐全。流程见 [apple-code-signing.md](../deploy/apple-code-signing.md)
- **Sentry Source Map 上传**：`AGENT567_SENTRY_AUTH_TOKEN`
- **Langfuse**：`LANGFUSE_SECRET_KEY`

`AGENT567_REQUIRE_MAC_SIGNATURE=1` 仅供 macOS CI 产物校验步骤使用，不是客户端配置。

---

## CI

`.github/workflows/desktop-release.yml` 在 `prepare` job 解析构建配置，并写入 `desktop-production` Environment。优先级：

1. **Actions → desktop-release → Run workflow 表单**（仅 `workflow_dispatch`；选 `default` 或留空表示不覆盖）
2. **Environment / 仓库 Variables**（job 声明了 `environment: desktop-production` 时，Environment 覆盖同名仓库变量）
3. 内置默认：`AGENT567_RELEASE_TARGET=github`、云功能关闭，即开源 GitHub Release

GitHub 能力源在两种版本中默认使用 567 Agent 官方市场；`AGENT567_OPEN_MARKETPLACE_REPOSITORY` Variable
和手动运行时的 `marketplace_repository` 表单可覆盖该仓库。用户仍可在软件内添加其他 GitHub 来源。

**fork 不配任何 Variables 就得到开源版构建。** 官方商业版 GitHub Release 在 Settings → Environments → `desktop-production` → Environment variables 设置：

```
AGENT567_CLOUD_ENABLED = true
API567_BASE_URL = https://api.567.wiki/api/v1
AGENT567_RELEASE_TARGET = github
AGENT567_UPDATE_URL = https://github.com/Chinachani/567-agent/releases/latest/download
```

GitHub 商业版使用 generic 更新源，因此必须提供 `AGENT567_UPDATE_URL`。设计库固定从 `Chinachani/567-agent-style-library` 自动拉取，无须配置 GitHub Variable。R2 发布需设置 `AGENT567_RELEASE_TARGET=r2`、`AGENT567_R2_BUCKET`、`AGENT567_R2_PREFIX` 和 `AGENT567_UPDATE_URL`。test 通道只能发布到 R2，并且必须使用独立的 `desktop-test` 配置、`AGENT567_R2_PREFIX_TEST`、`AGENT567_UPDATE_URL_TEST` 与 R2 Secrets，不能指向 production feed。

表单可以覆盖版本形态、服务端地址、租户、语音开关、发布目标和通道。`AGENT567_CLOUD_ENABLED=true` 可与 GitHub 或 R2 发布目标搭配。**不要在表单里填签名密钥、R2 凭据或 DSN**——它们继续走 Secrets。

发布矩阵前会先等待独立质量 Job：根 `bun run check`、质量脚本测试、Desktop packaging 合同测试全部通过后才开始平台构建。每个平台构建后还会校验 updater metadata、hash、blockmap 和可安装内容。

匹配 Desktop 版本的 tag，以及解析后 channel 为 `stable` / `test` 的 `workflow_dispatch` 会进入发布流程；其他手动构建只保留 Actions Artifact。当前 Release workflow 发布 Windows、Linux 与 Android，不构建 macOS。发布后会检查各桌面平台的更新元数据和对应安装包。表单定义必须在 GitHub 默认分支上才看得到。下载预热、阶段检查点和失败重跑方法见 [发版缓存与失败恢复](./release-ci.md)。
