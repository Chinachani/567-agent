# 567 Agent

567 Agent 是围绕 567 API 服务打造的 AI Agent 客户端项目，包含桌面应用、Android 客户端、命令行宿主和 IM 网关。桌面端把对话、项目文件和 Agent 工具放在本机工作区中；Android 可独立发起对话，也可连接桌面端继续会话或远程操作桌面。

## 获取应用

正式版本和各平台文件发布在 [GitHub Releases](https://github.com/Chinachani/567-agent/releases)。请以每个版本页面列出的文件和发布说明为准。

当前 Release 页面会列出对应版本和平台的可用文件。桌面端发布格式包括 Windows 安装程序、MSI 与便携 ZIP，以及 Linux AppImage、DEB 和 RPM；Android 版本以 Release 页面列出的 APK 为准。

Android 用户如因签名更换而无法覆盖安装，可先导出旧版聊天记录，再卸载旧版并安装新版，最后导入记录。操作步骤见[聊天记录迁移指南](docs/apps/mobile/chat-history-migration.md)。

## 项目能做什么

- **桌面 Agent 工作区**：在项目目录中与 Agent 协作，使用模型、工具和本机文件完成编码及其他工作任务。
- **本机能力与扩展**：项目包含命令和文件工具、MCP、知识库、技能、插件、主题、批量任务及相关运行时模块。具体能力取决于应用构建和配置。
- **MCP 风险提示**：对尚未人工核验的 MCP，客户端可生成供用户复制给 AI 的评估提示词。项目文档链接只取该 MCP 条目的文档元数据；缺失的作者、许可或文档信息会明确标为未提供，不用市场目录仓库地址代替。风险提示使用 Markdown 标记，表格会为过长字段提供换行。
- **Android 客户端**：通过 567 API 在手机上直接聊天，或连接桌面端继续会话；支持配对后的桌面远程预览与控制。
- **IM 网关**：桌面端可托管 Go 编写的网关，将已配置的即时通讯渠道接入本机 Agent。渠道支持情况和配置要求见 [IM 网关说明](apps/im-gateway/README.md)。
- **本地会话数据**：桌面会话与配置保存在本机；IM 会话可与桌面会话共享。网络请求仍会发送到所配置的模型、567 API 或已启用的集成服务。

手机端登录、模型连接和网络问题可参考[手机端连接与模型排障](docs/apps/mobile/chat-connection-troubleshooting.md)。

## 从源码运行

仓库使用 Bun 管理 TypeScript monorepo，Android 应用使用 Kotlin Multiplatform，IM 网关使用 Go。开发桌面端需要 Bun 1.3+ 和 Node.js 20+：

```bash
bun install
cd apps/desktop
bun run dev
```

桌面开发环境默认使用独立的 `~/.vetta-dev` 配置目录。仓库根目录的 `bun run dev` 只启动部分核心包的开发监听，不会启动 Electron 桌面应用。

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

## 安全与数据

提交漏洞前请阅读 [`SECURITY.md`](SECURITY.md)，不要在公开 Issue 中披露可利用的安全细节。第三方组件与版权信息见 [`NOTICE`](NOTICE)，项目使用的开源许可见 [`LICENSE`](LICENSE)。
