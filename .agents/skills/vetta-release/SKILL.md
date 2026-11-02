---
name: vetta-release
description: 准备 567 Agent 双端版本、检查候选并发布 GitHub Release。仅在用户明确要求改版本或发布时使用；普通开发与源码推送不触发发布。
---

# 567 Agent 发布流程

仓库根 AGENTS.md 与现有发布脚本是约束来源。已有会话授权继续有效，按实际状态接续；用户指定 Luna 时由 Luna 监控。不得 reset、stash、clean、跳过 hooks、force push 或移动已有标签。

## 版本准备

`node scripts/release/release-version.mjs --start-next [patch|minor|major|x.y.z]` 同步 Desktop、Android、锁文件和新版本说明。开发版本改名使用 `--retarget x.y.z`。先核对远端发布与标签，不只依赖说明里的状态注释。

开发说明标题下一行写 `<!-- release-status: unreleased -->`。已发布版本的正文保持原样；下一版本可依据已核实的当前发布标签开启，无需回写旧正文的状态注释。

## 候选与标签

1. 逐路径审查、暂存并正常提交，先把候选推到 `Chinachani/567-agent` 的 main，固定完整 SHA。
2. 等待该 SHA 的 quality、desktop-packaged 全部成功；涉及手机时同时核对 mobile。失败先修源码、正常新提交，重新等待新 SHA；旧提交、PR 或本机结果不能替代。
3. 运行 `node scripts/release/release-preflight.mjs`。它校验双端版本、说明、远端 main、工作树与新标签，并复用 `require-release-preflight.mjs` 的官方同 SHA CI 门禁。任何查询失败都先解决，不能绕过。
4. 创建 annotated 新标签，单独推送该标签。候选代码首次推送与未经准入的标签不得一起推送。

## 跟踪与完成

跟踪本次 desktop-release，失败读取具体 job 日志后处理。已有 tag 不移动；源码修补需要新版本时重新走候选门禁。

完成后核对 tag peeled SHA、Release 非 draft/prerelease、正文与标签源码一致、当前 workflow 预期资产、公开更新源及可取得的正式 APK 包名/版本/签名。慢速额外下载不无限阻塞发布结论，未完成文件不得称完整制品。

只在失败、需要用户操作或发布完成时通知，状态不变保持静默；完成后删除对应心跳。没有发布授权时停在源码准备，不创建标签或部署。
