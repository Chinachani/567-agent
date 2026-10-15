# @567agent/runtime-node

567 Agent Runtime 协议的共享 Node.js 实现层。

本包拥有文件系统、进程、锁、本地持久化及 Node Coding Tool 的具体行为，可由 Desktop、CLI
和服务端 Node Host 复用。产品或平台 Composition Root 负责选择和配置适配器；协议包不包含 Node I/O。

主要入口：

- `@567agent/runtime-node/conversation`：文件/内存 Repository、租约、原子发布、会话服务与 Legacy 迁移
- `@567agent/runtime-node/coding`：具体 Coding Tool、Schema、模型描述、文件/命令/PDF/OCR 实现与 Node Host 原语
- `@567agent/runtime-node/mcp`：文件配置与凭证、stdio/HTTP Client、MCP SDK/OAuth 和 Device Flow 实现
- `@567agent/runtime-node/host`：资源、Knowledge、结果制品与通用文本文件等 Node Host 适配器

`runtime-node` 不拥有 Agent Turn/Session Kernel，也不拥有 Electron IPC、Desktop 生命周期、UI 或产品策略。
平台无关编排属于 `runtime-core`，Desktop 生命周期和平台装配属于 `runtime-desktop`。当前
`coding-agent` 的 Node 宿主显式选择本包实现；非 Node 宿主不得依赖本包。

命令进程使用共享的资源保护：Linux 在启动前设置可写分配上限，三平台采样进程树与宿主命令合计占用，并限制命令输出大小。失败沿现有命令错误路径传播，后台任务不会把保护停止误记为成功。[预算配置与保护范围](../../docs/desktop/tool-resource-protection.md)。

`@567agent/runtime-node/host` exports `killNodeProcessTree` for hosts that own a spawned command. POSIX callers must create a detached process group before using this helper; Windows uses `taskkill /T /F`. Command cancellation and timeout settle independently of pipe closure; output and memory ownership continue until pipes close even if the root has exited. Linux DATA limits keep a 1 GiB floor for Node 24 startup while RSS sampling applies lower configured budgets.
