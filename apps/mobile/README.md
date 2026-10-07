# 567 Agent Android

Android 客户端提供两种对话方式：连接 567 Agent 继续桌面会话，或在手机上通过 567 API 直接对话。远程桌面预览可查看画面并发送输入；它与手机端直接对话使用不同的连接配置。

会话列表按设备来源分区。手机端可按需读取已连接 Desktop 的会话目录；打开某条 Desktop 会话后，才从电脑拉取消息历史并在手机本地缓存。同步方向是 Desktop 到手机，Desktop 不读取手机端会话。

手机端默认会在云端对话结束后生成最多三条后续提问建议，可在「我的 → 设置 → 使用体验 → 预测下一句」关闭。远程桌面首次显示画面时，Desktop 会要求本机用户确认并选择要共享的屏幕或窗口；取消或系统未提供屏幕来源时，手机会显示对应状态。

## 用户指南

- [聊天记录迁移](../../docs/apps/mobile/chat-history-migration.md)：签名更换、重装前导出和导入本地会话。
- 聊天附件图片保存在应用私有文件中，消息记录只保存附件引用；迁移备份仍会把图片包含在加密文件里。
- [手机端连接与模型排障](../../docs/apps/mobile/chat-connection-troubleshooting.md)：检查登录、模型目录和聊天连接问题。
- [Mobile 文档索引](../../docs/apps/mobile/README.md)：远程桌面开发、真机测试和排障资料。

## 开发

这是 Kotlin Multiplatform 项目。共享 Compose UI、业务逻辑和数据层位于 `shared/src/commonMain`；Android 专属实现位于 `shared/src/androidMain`；应用入口位于 `androidApp`。

在 `apps/mobile` 目录运行：

```bash
./gradlew :androidApp:assembleDebug
./gradlew :androidApp:assembleDebugTest
./gradlew :shared:testAndroidHostTest
```

`assembleDebugTest` 会生成可与正式应用并行安装的测试版（包名 `com.api567.agent.test`）。

连接已启动的 Android 设备或模拟器运行仪器测试：

```bash
./gradlew :shared:connectedAndroidDeviceTest
```

## APK 签名

发布签名材料不能存放在仓库。构建正式版前，通过本机环境变量或用户级 `~/.gradle/gradle.properties` 配置：

- `AGENT567_ANDROID_KEYSTORE_PATH`
- `AGENT567_ANDROID_KEYSTORE_PASSWORD`
- `AGENT567_ANDROID_KEY_ALIAS`
- `AGENT567_ANDROID_KEY_PASSWORD`

Local release builds and GitHub Actions use `AGENT567_ANDROID_*` signing variables.

不要把密码写入仓库中的 `gradle.properties`。Debug 构建使用 Android 标准 debug 密钥。

签名迁移期间使用单独的 legacy 密钥构建过渡 APK：

```bash
./gradlew :androidApp:assembleMigration
```

过渡版配置使用 `AGENT567_ANDROID_MIGRATION_KEYSTORE_PATH`、`AGENT567_ANDROID_MIGRATION_KEYSTORE_PASSWORD`、`AGENT567_ANDROID_MIGRATION_KEY_ALIAS` 和 `AGENT567_ANDROID_MIGRATION_KEY_PASSWORD`。密钥必须保存在仓库之外；迁移密钥仅用于过渡 APK，正式版必须使用新的发布密钥。用户操作步骤见[聊天记录迁移指南](../../docs/apps/mobile/chat-history-migration.md)。

## Remote Desktop 开发预览

远程桌面需要 Desktop 与 Android 配对，并使用 Cloudflare Relay 传递配对和信令。真机验证步骤、权限要求和故障定位见 [Mobile 文档索引](../../docs/apps/mobile/README.md)。
