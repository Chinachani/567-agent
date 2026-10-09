# 主题示例

当前主题实现由独立风格库维护，并通过定时同步进入桌面应用的策展主题目录。应用仓库不再维护内置主题源码。

## 主题实现约定

- 使用 `@vetta-org/theme-sdk` 声明 `ThemeModule` 和运行时能力。
- 使用 `@vetta-org/theme-ui` 复用宿主公开的 UI 组件与样式能力。
- 资源、动画和文案与对应主题一起维护。
- 桌面应用只扫描已同步的主题归档，不直接导入主题源码。

开发流程与主题 manifest 字段见 [创建主题模块](../../apps/docs-site/content/docs/themes/getting-started.mdx)。
