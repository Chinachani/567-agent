# 发布说明（Release Notes）

每个桌面端版本一个文件，命名为 `v<major>.<minor>.<patch>.md`，例如 `v0.5.58.md`。
`desktop-release` 工作流发布 GitHub Release 时，直接把对应文件作为 Release 正文，
所以这里写的就是用户在 Release 页面读到的内容。

## 什么时候写

新增功能、修复缺陷、合并 PR、关闭 issue 之后，把对应条目补进**当前开发中版本**的文件里
（版本号以 `apps/desktop/package.json` 的 `version` 为准）。文件不存在就新建。
发布流水线会校验该文件存在，缺失即发版失败。

## 怎么写

- 标题用 `# 567 Agent <版本号>`，下一行写 `<!-- release-status: unreleased -->`，再写发布日期或“开发中”。
- 分 `## 新增` / `## 改进` / `## 修复` / `## 其他` 四节，没有内容的小节直接省略。
- 面向用户描述影响：说清楚用户会看到什么变化，而不是改了哪个函数。行为有取舍时把代价一并写出来。
- 关联 PR 或 issue 时统一用 `owner/repo#123` 格式，例如 `Chinachani/567-agent#8`。
- 已发布版本的文件不再修改；发现写错另起一条修订说明。

历史版本（0.5.48 及更早）的记录留在 `apps/desktop/CHANGELOG.md`。

## 版本准备与状态

`node scripts/release/release-notes.mjs --status` 查看说明中的状态；没有标记的历史文件保持只读。公开发布事实还须核对远端 tag 与 GitHub Release，不能只依赖注释。

`node scripts/release/release-version.mjs --start-next [patch|minor|major|x.y.z]` 同步 Desktop、Android、锁文件和新说明；`--retarget x.y.z` 改开发中版本。已发布正文不回写，已核实当前 tag 发布后可以直接开启下一版本。

标签前运行 `node scripts/release/release-preflight.mjs`，它校验本地与远端 main、双端版本和说明，并复用同 SHA CI 准入。完整流程见 `.agents/skills/vetta-release/SKILL.md`；本机检查不替代候选流水线。

候选提交现在也会通过 `node scripts/release/candidate-metadata.mjs` 校验双端版本、锁文件和说明内容；这是离线元数据校验，不能替代同 SHA CI 准入。改号脚本先准备所有文件，发生可捕获的写入错误时恢复已写文件；多文件写入不承诺在断电或进程强杀时原子完成。

Actions 中 Node 测试通过统一 runner 生成各 workspace 的 `.test-reports/*.xml`，保留原终端报告和失败退出码；Android 保存 XML/HTML 报告，隔离布局步骤保存控制台日志，保留期 7 天。不会因重试将失败测试转换为成功，也不上传用户真实配置目录。
