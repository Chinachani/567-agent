# 上游检查

仓库同时保留 `upstream` 和 `zcode` Git remote。`upstream` 指向 `openvetta/open-vetta`，`zcode` 指向 `zai-org/ZCode`。两者都用于持续比较高价值变化，不自动合并进 567 Agent。

运行以下命令检查 OpenVetta 与 ZCode 的新提交：

```bash
bun run check:upstreams
```

这是所有上游审查的统一入口。检查读取 [sources.json](./sources.json) 中的固定基线，先通过 GitHub commits API 校验当前引用的精确 40 位 SHA，再用该 SHA 发起 compare；校验结果与固定基线一致时跳过 compare。rename 的旧路径仍参与高价值目录匹配，但一个 diff entry 只计一次。OpenVetta 变更量大到 GitHub compare 只返回 300 个 diff entry，或响应缺少 `files` 时，结果标记为 `partial-update` 并附上完整 API 与浏览器 compare 链接；不把截断结果误报为完整更新。compare 失败但 head SHA 已确认时，结果同样保留精确 head、两个 compare 链接和失败原因。compare 返回 behind 或 diverged 时不是完整的前向 diff，也标记为 `partial-update`。网络不可用时默认给出可审计的跳过结果，不阻塞离线开发。

`sources.json` 的 `highValuePaths` 是复审优先级，不是全量清单。命中这些目录时状态标记为 `high-value-update`，输出最多列出 `UPSTREAM_FILE_PREVIEW_LIMIT` 个路径（默认 12 个）。ZCode 命中高价值路径后的审查清单见 [zcode-audit.md](./zcode-audit.md)，需要结合本地包边界、权限模型、协议兼容性和现有测试单独审查。

发布或定期同步任务使用 `--strict`。此时任何更新、partial、截断或不可用结果都返回非零状态，便于把上游确认变成显式门禁：

```bash
bun run check:upstreams -- --strict
```
