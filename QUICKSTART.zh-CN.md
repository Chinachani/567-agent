# 快速开始

<p align="center"><a href="QUICKSTART.md">English</a> · <b>简体中文</b></p>

两条路：安装现成构建，或从本仓库跑桌面应用。

## 上游安装包参考

Open Vetta 上游提供 macOS、Windows、Linux 安装包；这些不是 567 Agent 的安装包：

**→ [www.openvetta.com/download](https://www.openvetta.com/download)**

上述安装包和产品文档属于上游 Open Vetta。本仓库提供 567 Agent 源码；从源码运行时可自行配置模型（BYOK）和权限。

从本仓库源码检出得到的是 **lite** 构建：无上游 Vetta 登录、无订阅，密钥留在本机。上游安装包可能是 **full** 构建；两种形态见[构建模式](docs/desktop/build-modes.md)。

## 从源码开发

需要 **Bun 1.3+** 和 **Node 20+**。支持 macOS、Windows、Linux。

```bash
# 在本仓库根目录执行
bun install
```

### 桌面应用

```bash
cd apps/desktop
bun run dev
```

会同时启动 Vite renderer、主题开发服务器和 Electron。数据目录是 `~/.vetta-dev`，不会动已安装应用的 `~/.vetta`。

| 命令 | 数据根 | 什么时候用 |
|---|---|---|
| `bun run dev` | `~/.vetta-dev` | 默认沙箱 |
| `bun run dev:home` | `~/.vetta` | 希望开发构建读写真实用户数据 |

仓库**根目录**的 `bun run dev` 只监视核心库，不会启动应用。

### 文档站

```bash
bun run --cwd apps/docs-site dev
```

默认 `http://127.0.0.1:4321`。公开文档在 `apps/docs-site/content/docs/`。

### 实际会跑的检查

```bash
bun run check:quick        # 对改动文件跑 Biome + 架构守卫
bun run check              # 开 PR 前：lint + 类型 + 守卫
bun run test:pkg ai        # 单包；`bun run test:pkg --list` 查看包名
```

不要直接跑 `bun test`。Windows 上会用错 runner；请用 `bun scripts/quality/run-vitest.mjs --run <file>` 或 `bun run test:pkg`。

打包、环境变量和 lite/full 开关：[构建模式](docs/desktop/build-modes.md)。贡献地图和 PR 门槛：[CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。
