# 567 Agent 图标

用户于 2026-10-21 确认采用 B 修订方向：`[567]`、居中的琥珀色线与点、哑光黑白底、减少金属纹理与发光。插图保留原样，后续单独决定。

## 事实源

- `mark.svg`：转曲后的标识几何，不依赖本机字体。
- `icon-dark.svg`、`icon-light.svg`：应用图标母版；导出时检查三份 SVG 的数字与括号路径一致。
- `generated-assets.json`：源文件与全部导出文件的 SHA-256，用于检查资源漂移。

母版来自用户指定的设计会话。小图基于同一几何放大留白内的标识，日夜变体保持形状与琥珀色一致，不分别生成不同字形。

## 重新导出

在仓库根运行：

```bash
python3 scripts/generate-brand-assets.py
```

导出机需要系统级 librsvg、cairo、gobject（Debian/Ubuntu：`librsvg2-2 libcairo2 libglib2.0-0`），不增加产品依赖。PNG、ICO、ICNS 和各端使用的副本均由脚本生成，不手工修改。

覆盖桌面应用/安装器/Dock、托盘、Renderer 侧栏与登录品牌图、Android 传统与自适应启动图标、文档站图标和 favicon。Android 自适应图标的前景保留安全边距，背景是独立的纯色资源。

Windows/Linux 托盘随 Electron 当前有效主题切换日夜图；两个变体自带对比底，应用主题和系统面板背景不同时仍有边界。macOS 使用单色透明 template，由系统处理菜单栏反相。应用标识、包名、数据目录及凭证身份不随视觉资源变化。

本轮的资源检查和托盘定向回归不能替代真实 Windows 安装/恢复矩阵，也不代表已完成各系统托盘与 Android 启动器的真机观感验收。
