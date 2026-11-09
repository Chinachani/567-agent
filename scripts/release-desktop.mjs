#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The old combined branch/tag push could bypass same-commit CI admission.
// Keep the alias as an explicit migration error; all release operations use
// the existing version/preflight commands, with no alternate publishing path.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	console.error(`旧 release:desktop:patch/minor 入口已停用，未修改文件或推送任何内容。
请按 docs/desktop/release-ci.md 执行发布：
1. 使用 node scripts/release/release-version.mjs 准备双端版本与说明。
2. 正常提交并单独推送 main 候选，等待同一完整 SHA 的 CI 全部通过。
3. 运行 node scripts/release/release-preflight.mjs。
4. 准入通过后创建 annotated 新标签并单独推送，继续核对 Release。`);
	process.exitCode = 1;
}
