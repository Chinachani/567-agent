# 依赖补丁

## Cloudflare Workers 测试池 0.12.21

`@cloudflare/vitest-pool-workers` 通过 HTTP 头传递模块跳转路径和测试启动数据。
包含中文的工作区路径会触发 Node 的 ByteString 校验失败；仅编码跳转头还会导致
Vite 和文件系统使用百分号编码路径，无法找到模块。

补丁将跳转路径编码、文件系统与 Vite 查询路径解码，并将启动 JSON 中的非 ASCII
字符转为等价 Unicode 转义。模块身份保持一致，ESM 与 CJS shim 共用同一解析链。
已有的字面百分号文件名和无效 URI 转义保留原值。

补丁由 `bun patch` 生成，声明在根 `package.json` 的 `patchedDependencies` 中，
`bun install --frozen-lockfile` 自动应用。它仅影响测试工具，不进入应用产物。

回归验证：

```bash
bun scripts/quality/run-vitest.mjs --run scripts/quality/cloudflare-worker-paths.test.mjs
bun run test:pkg remote-relay
```

第二条需在含中文与空格的工作区中运行，以验证完整 Workers 启动与模块加载。
升级依赖时，确认上游同时修复头编码和路径解析后，再删除补丁及对应合同测试。
