# 567 Agent

567 Agent 是围绕 567 API 服务打造的 AI Agent 客户端项目，包含桌面应用、Android 客户端、命令行宿主和 IM 网关。桌面端把对话、项目文件和 Agent 工具放在本机工作区中；Android 可独立发起对话，也可连接桌面端继续会话或远程操作桌面。

## 版本与近期更新

当前正式版为 [v1.5.3](https://github.com/Chinachani/567-agent/releases/tag/v1.5.3)，最新安装包请从 [GitHub Releases](https://github.com/Chinachani/567-agent/releases/latest) 获取。`main` 正在准备 **1.5.4**；源码中的新功能需等对应安装包发布后才能在正式客户端使用。

1.5.4 候选包含：

- **连接当前浏览器**：识别系统默认浏览器，可手选 Chrome、Edge 或 Chromium，操作已登录标签页。Edge 提供内置官方扩展准备入口和分步指南，Chrome/Chromium 保留商店安装。
- **任务与历史恢复**：单轮模型调用上限可调整或关闭；分叉入口位于 AI 回复下方，补齐零输出失败后的历史续接。原始会话与用量记录保留。
- **文件与工作台**：文档引擎按需加载；补齐 XLSX 基础样式、合并单元格和 CSV/TSV 表格查看，改善 PDF、DOCX、演示文稿及手机工作台的打开与保存反馈。
- **设计画布**：设备预设、圆角调整、长画框、撤销重做、设备交互模拟与公开图库素材；保留原有文档版本历史和数据目录。
- **操作入口与界面**：新会话速启入口、显式 `/` 和 `@` 按钮、一级设置导航，以及引用浮层、资源右键菜单、交付列表和更新说明排版修补。
- **兼容与构建**：适配上游更新；场景入口与执行退役，旧文件、安装记录和会话原文保留。候选版本检查前置，失败时保留 CI 测试和布局诊断。

完整内容与已知限制见 [1.5.4 开发说明](.github/release-notes/v1.5.4.md)；历史版本见 [发布记录](https://github.com/Chinachani/567-agent/releases)。

## 获取应用

正式版本和各平台文件发布在 [GitHub Releases](https://github.com/Chinachani/567-agent/releases)。请以每个版本页面列出的文件和发布说明为准。

当前 Release 页面会列出对应版本和平台的可用文件。桌面端发布格式包括 Windows 安装程序、MSI 与便携 ZIP，以及 Linux AppImage、DEB 和 RPM；Android 版本以 Release 页面列出的 APK 为准。

同包名、同签名的正式版优先覆盖安装以保留本机数据。Android 测试版使用独立包名；遇到旧版签名更换时，先按[聊天记录迁移指南](docs/apps/mobile/chat-history-migration.md)导出并核对备份，再处理安装，避免直接卸载丢失记录。

## 项目能做什么

- **桌面 Agent 工作区**：在项目目录中与 Agent 协作，使用模型、工具和本机文件完成编码及其他工作任务。
- **长任务与成果交付**：查看任务状态、待回答问题和权限审批，确认后从历史继续；“文件与链接”汇总会话产物，右侧工作台承载文件、浏览器与预览。
- **设计与富媒体**：设计风格库与画布协作，Markdown 支持公式、Mermaid、图片及隔离的 SVG/HTML 预览。
- **本机能力与扩展**：项目包含命令和文件工具、MCP、知识库、技能、插件、主题、批量任务及相关运行时模块。具体能力取决于应用构建和配置。
- **能力市场筛选与 MCP 风险提示**：支持按类型、分类、审核状态和标签组合筛选。尚未人工核验的 MCP 添加前会显示风险说明，并提供供用户复制给 AI 的评估提示词；客户端不会自动发送提示词或安装 MCP。项目文档链接只取该 MCP 条目的文档元数据；缺失的作者、许可或文档信息会明确标为未提供，不用市场目录仓库地址代替。风险提示使用 Markdown 标记，表格会为过长字段提供换行。
- **Android 客户端**：通过 567 API 在手机上直接聊天，或连接桌面端继续会话；支持配对后的桌面远程预览与控制。
- **IM 网关**：桌面端可托管 Go 编写的网关，将已配置的即时通讯渠道接入本机 Agent。渠道支持情况和配置要求见 [IM 网关说明](apps/im-gateway/README.md)。
- **本地会话数据**：桌面会话与配置保存在本机；IM 会话可与桌面会话共享。网络请求仍会发送到所配置的模型、567 API 或已启用的集成服务。

手机端登录、模型连接和网络问题可参考[手机端连接与模型排障](docs/apps/mobile/chat-connection-troubleshooting.md)。

## 连接已登录的浏览器

在 **设置 → 通用设置 → 连接当前浏览器** 中选择目标。首次设置可识别系统默认应用；保存后按所选目标连接，不随系统默认应用改变。

| 目标 | 安装方式 |
| --- | --- |
| Edge | 点击“准备内置扩展并启用连接”，软件校验并解压微软官方扩展、打开 `edge://extensions/`；按内置指南开启开发人员模式、选择“加载解压缩的扩展”和对应目录。保留 Chrome 商店备用入口。 |
| Chrome / Chromium | 点击“打开安装页并启用连接”，在 Chrome 网上应用店确认添加微软官方 Playwright Extension。 |

首次执行浏览器任务仍需在扩展中批准连接并选择标签页。配置启用不代表已经连接；无需增加浏览器调试启动参数。Edge 内置解压版不会自动接收商店更新，请保留加载目录；连接组件首次启动仍需联网准备。

安装与排查详见[浏览器使用指南](apps/docs-site/content/docs/product/browser.mdx)。登录、验证码和二次验证由用户完成；浏览器任务沿用所选页面和现有权限边界。

## 从源码运行

仓库使用 Bun 管理 TypeScript monorepo，Android 应用使用 Kotlin Multiplatform，IM 网关使用 Go。Bun 版本以根 [`package.json`](package.json) 的 `packageManager` 为准，Node.js 版本以 [`.node-version`](.node-version) 为准；当前分别为 **Bun 1.3.14、Node.js 24.19.0**。

```bash
bun install
cd apps/desktop
bun run dev
```

桌面开发环境默认使用独立的 `~/.567agent-dev` 配置目录。仓库根目录的 `bun run dev` 只启动部分核心包的开发监听，不会启动 Electron 桌面应用。

Android 开发和 APK 签名配置见 [`apps/mobile/README.md`](apps/mobile/README.md)；完整开发入口见[快速开始](QUICKSTART.zh-CN.md)。

## 仓库结构

本仓库是客户端开源仓库，不包含 567 API 的服务端、管理后台或官网。主要目录如下：

| 路径 | 内容 |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Electron 桌面应用 |
| [`apps/mobile`](apps/mobile) | Kotlin Multiplatform Android 客户端 |
| [`apps/cli-host`](apps/cli-host) | Coding Agent 命令行宿主 |
| [`apps/im-gateway`](apps/im-gateway) | Go 即时通讯网关 |
| [`apps/docs-site`](apps/docs-site) | 项目文档站源码 |
| [`packages/ai`](packages/ai)、[`packages/agent`](packages/agent) | 模型协议与 Agent 核心循环 |
| [`packages/coding-agent`](packages/coding-agent)、`packages/runtime-*` | 产品能力组合与运行时模块 |
| [`packages/plugins`](packages/plugins)、[`packages/themes`](packages/themes) | 插件、预置扩展和主题 |

架构决策记录位于 [`docs/adr`](docs/adr)，贡献指南见 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。

## 参与开发

常用检查命令：

```bash
bun run check:quick             # 检查指定改动或当前工作区
bun run check                   # lint、类型检查和架构守卫
bun run test:pkg <包名>         # 运行指定包的测试
bun run test:changed -- <文件>  # 运行与改动相关的测试
```

请使用仓库脚本运行测试，不要在 monorepo 根目录执行裸 `bun test`。完整贡献约定见 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。

推送 `main` 会触发质量检查、Android 候选检查与适用的桌面打包验证。正式发布需等待同一提交的候选检查通过，再运行官方 preflight、单独推送新版本标签；源码推送本身不会发布新安装包。发布与自建构建变量见[桌面发布手册](docs/release/desktop-release-runbook.md)。

## 安全与数据

提交漏洞前请阅读 [`SECURITY.md`](SECURITY.md)，不要在公开 Issue 中披露可利用的安全细节。第三方组件与版权信息见 [`NOTICE`](NOTICE)，项目使用的开源许可见 [`LICENSE`](LICENSE)。
