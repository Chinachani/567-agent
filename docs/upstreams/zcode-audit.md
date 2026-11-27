# ZCode 适配审计

审计基于 [ZCode a4b4445](https://github.com/zai-org/ZCode/tree/a4b4445141eb7d3b3e99eada9292775383bfc44e)。已落地的改进包括命令面板近期会话和正文命中，以及共享模型流与 Android 手机直连的首段等待、流中超时、空响应恢复和请求退避。共享 Node 命令宿主也已接入进程树终止。Linux 上用真实多级进程树验证，Windows PID 复用用模拟系统进程表验证。[双上游检查](./README.md)

| 优先级 | 候选与接入位置 | 验收条件 |
|---|---|---|
| 1（已接入） | 进程树终止。参考 ZCode 的 `packages/services/src/process/processTreeTerminator.ts`，落在 `packages/runtime-node/src/coding/host/process-tree.ts`。 | 普通取消先请求退出，宽限期后强制终止。Windows 对根进程与已识别的后代校验创建时间，执行信号时复核系统句柄。仍需 Windows 真机验证。 |
| 2（已接入） | 同模型签名失效恢复。参考 ZCode CLI 的 `packages/adapters/src/model/reasoning-history-normalization.ts`。 | 共享端覆盖 Anthropic Messages、Bedrock Converse 上的 Claude、Gemini Developer API、Vertex AI、Cloud Code Assist，以及 OpenAI、Azure、Codex Responses。Android 直连 Responses 也按服务、分组、模型和协议隔离回放签名。仅在明确拒绝、尚未输出内容且未报告用量时修复一次，成功后随回复持久化恢复边界。旧记录继续兼容，工具调用和工具结果保持成对回放。 |
| 3（已接入） | 跨端恢复未确认的远程发送。参考 ZCode 的 `pendingCommandRegistry.ts`，在 Android 远程会话网关复用已有的 `session.turn.read`。 | 应用重启后可以续接已被桌面接收的任务。未被接收时给出重新发送或取消入口，并用同一请求标识去重。 |
| 4（已接入） | 受管 Worktree 和回合级文件回退。参考 ZCode 的 `managed-worktree-tasks` 与 `gitCheckpointService.ts`，接入桌面项目「会话协作 → 独立工作区」和工作台「修改 → 按回合恢复文件」。 | 写任务按工作目录调度。运行中、排队中、有未保存文件或独有提交的 Worktree 受移除保护。回合恢复先预览增改删，再逐文件确认并跳过后来发生冲突的内容。Linux 真实 Git、桌面 Runtime 工具回合与组件回归已验证。Windows、macOS 桌面客户端尚待实测。 |

上游更新涉及进程、存储或权限时，同时复核文件锁与损坏恢复、Stdio 握手和关停、远控回放背压、SSH 部署锁、CA 合并、插件事务激活和 Worktree Hook 信任。每项适配按本地调用链和权限边界验证。
