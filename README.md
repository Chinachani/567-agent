# 567 Agent

567 Agent 是支持 567 API、第三方服务商和本地模型的 AI Agent 客户端项目，包含桌面应用、Android 客户端、命令行宿主和 IM 网关。桌面端把对话、项目文件和 Agent 工具放在本机工作区中；Android 可独立发起对话，也可连接桌面端继续会话或远程操作桌面。

[下载应用](https://github.com/Chinachani/567-agent/releases/latest) · [从源码运行](#从源码运行) · [预设仓库](https://github.com/Chinachani/567-agent-presets) · [参与开发](CONTRIBUTING.zh-CN.md)

本文介绍当前源码的功能与使用入口。`main` 是开发分支，已发布安装包的功能和已知限制请以对应 Release 的说明为准。

## 获取应用

正式安装包从 [GitHub Releases](https://github.com/Chinachani/567-agent/releases/latest) 获取，各平台文件以 Release 页面实际提供的资产为准。

| 平台 | 安装包格式 |
| --- | --- |
| Windows | EXE 安装程序、MSI、便携 ZIP |
| Linux | AppImage、DEB、RPM |
| Android | APK |

同包名、同签名的正式版优先覆盖安装以保留本机数据。Android 测试版使用独立包名；遇到旧版签名更换时，先按[聊天记录迁移指南](docs/apps/mobile/chat-history-migration.md)导出并核对备份，再处理安装，避免直接卸载丢失记录。

## 项目能做什么

- **桌面 Agent 工作区**：在项目目录中与 Agent 协作，使用模型、工具和本机文件完成编码及其他工作任务。
- **模型与调用信息**：按 567 API、预设服务商、本地服务商管理模型及对应参数；查看 Token 用量、缓存命中率、首字耗时和生成速度。
- **专家与会话协作**：使用带工作流程的专家提示词，复制并定制独立档案；在项目中组织多个会话，分配职责和读写权限，搜索成员与协作任务。
- **长任务与成果交付**：查看任务状态、待回答问题和权限审批，确认后从历史继续；“文件与链接”汇总会话产物，右侧工作台承载文件、浏览器与预览。
- **文件、设计与富媒体**：工作台预览文档、表格、演示文稿和网页；设计画布支持设备预设、撤销重做与版本历史，Markdown 支持公式、Mermaid、图片及隔离的 SVG/HTML 预览。
- **本机能力与扩展**：通过命令和文件工具、MCP、知识库、技能、插件、主题和批量任务扩展工作流程。能力市场支持多仓库来源、分类筛选、搜索和分页；未审核 MCP 仅供查看。具体能力取决于应用构建和配置，详见[能力使用指南](apps/docs-site/content/docs/product/abilities.mdx)。
- **Android 与桌面远控**：在手机上直接聊天，或连接桌面端查看会话与工作台；配对后可预览、全屏操作桌面，使用键盘、鼠标左右键及触控板。平板点按取决于电脑的输入能力；Wayland 需要整块主屏与已授权的坐标映射。
- **SSH 与远程项目**：在设置中管理 SSH 主机，导入现有主机配置，选择远程目录并在项目中操作文件；身份确认和凭据管理沿用安全边界。
- **自动化与连接器**：按时间新建或继续会话，查看执行及错过记录；MCP 支持全局、项目范围与 SSE，项目配置执行前需要确认。
- **应用内下载**：桌面文件和更新包、Android 更新包支持条件允许时最多四路分片下载与断点恢复；不支持分片的来源使用单连接。更新包保留完整性和安装校验。
- **IM 网关**：桌面端可托管 Go 编写的网关，将已配置的即时通讯渠道接入本机 Agent。渠道支持情况和配置要求见 [IM 网关说明](apps/im-gateway/README.md)。
- **本地会话数据**：桌面会话与配置保存在本机；IM 会话可与桌面会话共享。网络请求仍会发送到所配置的模型、567 API 或已启用的集成服务。

手机端登录、模型连接和网络问题可参考[手机端连接与模型排障](docs/apps/mobile/chat-connection-troubleshooting.md)。

## 使用专家与会话协作

开发分支的智能体中心提供「专家」和「会话协作」两个入口：

- **专家**：内置任务规划、开发、研究、审阅、方案五类模板，可按分类和关键词查找。详情展示实际提示词中的工作流程；点击使用打开普通会话草稿，首次发送才创建会话并调用模型。内置模板只读，复制后可独立定制。
- **会话协作**：进入项目，把已有会话加入协作，设置职责和读写权限；也可通过「用专家新建会话」创建成员。项目、候选会话和任务记录支持搜索与分页。

专家沿用用户配置的模型、能力和权限。预设不会自动授予额外工具权限，后续源模板更新也不会覆盖用户保存的副本。旧团队入口转入现有会话协作，历史会话保留只读查看与停止旧任务的入口。

独立预设仓库为 [567-agent-presets](https://github.com/Chinachani/567-agent-presets)，用于维护专家提示词和配套流程。1.6 起客户端会自动刷新该来源，源码预设直接进入智能体中心；能力插件安装仍需用户主动启用。专家插件格式、分发方式和分类边界见[预设市场接入方案](docs/expert-preset-marketplace.md)。

## 连接已登录的浏览器

在 **设置 → 通用设置 → 连接当前浏览器** 中选择目标。首次设置可识别系统默认应用；保存后按所选目标连接，不随系统默认应用改变。

| 目标 | 安装方式 |
| --- | --- |
| Edge | 点击“准备内置扩展并启用连接”，软件校验并解压微软官方扩展、打开 `edge://extensions/`；按内置指南开启开发人员模式、选择“加载解压缩的扩展”和对应目录。保留 Chrome 商店备用入口。 |
| Chrome / Chromium | 点击“打开安装页并启用连接”，在 Chrome 网上应用店确认添加微软官方 Playwright Extension。 |

首次执行浏览器任务仍需在扩展中批准连接并选择标签页。配置启用不代表已经连接；无需增加浏览器调试启动参数。Edge 内置解压版不会自动接收商店更新，请保留加载目录；连接组件首次启动仍需联网准备。

安装与排查详见[浏览器使用指南](apps/docs-site/content/docs/product/browser.mdx)。登录、验证码和二次验证由用户完成；浏览器任务沿用所选页面和现有权限边界。

## 从源码运行

仓库使用 Bun 管理 TypeScript monorepo，Android 应用使用 Kotlin Multiplatform，IM 网关使用 Go。Bun 版本以根 [`package.json`](package.json) 的 `packageManager` 为准，Node.js 版本以 [`.node-version`](.node-version) 为准。

```bash
bun install
bun run --cwd apps/desktop dev
```

桌面开发环境默认使用独立的 `~/.567agent-dev` 配置目录。仓库根目录的 `bun run dev` 只启动部分核心包的开发监听，不会启动 Electron 桌面应用。

Android 开发和 APK 签名配置见 [`apps/mobile/README.md`](apps/mobile/README.md)，桌面开发与调试入口见[开发指南](docs/dev/README.md)。

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
