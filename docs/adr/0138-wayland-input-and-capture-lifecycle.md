# ADR 0138: Wayland 远程输入授权与捕获会话复用

状态：2026-10-22 本地候选，未发布。

## 背景

Linux 真机拒绝系统选屏后出现 SIGSEGV。原生隔离复现确认 Electron 34.5.8 存在 PipeWire 选屏取消后的生命周期缺陷，JS try/catch 无法修复。另一个独立问题是 Wayland 不能依赖 XTest 控制原生窗口；portal 来源也不能按未知 display_id 假定主屏绝对坐标。

## 决策

- 固定 Electron 35.7.5，包含上游 #46112 的异步释放修复。以私有 DBus、Xvfb 和模拟 ScreenCast portal 对比旧版崩溃、新版连续取消及媒体拒绝回调，避免读取用户桌面。
- 拒绝 getDisplayMedia 使用原生 null 结果；宿主只接受本窗口的视频请求，串行选屏，停止前结算未完成回调。回调只调用一次，迟到批准不能恢复输入或捕获。
- 捕获与传输分别拥有生命周期。一个 OS 授权产生母轨道，各 WebRTC 路线使用克隆轨道；开启自动共享时保留母轨道，重连复用。关闭记住选项后无使用者即释放；页面关闭、程序退出或撤销配对释放全部轨道。
- Wayland 使用已安装的 dbus-next 调用标准 RemoteDesktop portal，独立请求鼠标和键盘授权。普通相对移动不需要将未知屏幕来源误认为主显示器；手机按能力声明采用触控板手势。新相对输入包严格限制字段、数值和序号，旧端保持绝对输入合同。
- 系统允许持久授权时使用 persist_mode=2；轮换 restore_token 保存在现有加密凭据库，并限定配对身份。关闭输入、撤销配对清除保存令牌；停止进程仅关闭当前系统会话。读取、保存失败不会绕过系统许可。保存令牌失败不结束本次已明确批准的输入会话；系统 Session Closed 仅结束当前会话，不擅自删除后续恢复令牌。
- dbus-next 保留 CommonJS 外部依赖边界并随包分发，避免其可选原生加载器在 ESM bundle 中破坏全局错误栈。私有 DBus 的真实打包探针与捕获取消探针进入 Linux CI。
- 输入授权变化（包括系统关闭、队列溢出、输入失败）立即通知视频宿主，通过 DataChannel 更新手机的只读状态；每个授权会话独立拥有输入队列。
- 撤销先同步移除当前授权身份，再中止等待、关闭 DBus。已排队输入逐项核对身份；迟到批准不能重新开启控制。系统拒绝授权只影响输入，保留观看和配对连接。

## 2026-10-23 输入补充

Wayland 快捷键使用标准 evdev 物理键码；手机提交的文字通过电脑剪贴板和 Ctrl+V 粘贴，输入栏说明剪贴板会更新，不读取用户剪贴板。滚动使用逻辑像素，序列结束发送 finish；私有 DBus 与真实打包运行时验证系统调用签名及事件顺序，实际输入法和焦点效果由真机确认。

Wayland/PipeWire 系统选屏返回唯一来源时直接使用该结果，避免再弹出应用来源选择框。未记住手机时仍需应用批准；非 Wayland 和多个来源时保留原有选择。系统主动结束捕获后重新申请，取消后可以再次重试，不以自动共享绕过系统重新授权。

## 备选与边界

保留 XTest 并放开未知来源的主屏判定会产生错误坐标和不完整的 Wayland 控制，因此未采用。没有从 RustDesk 引入整套原生捕获、服务或提权组件；借鉴其会话复用和触控板交互，按标准 portal 实现。

当前稳定 Electron 捕获接口不提供跨重启的屏幕 restore_token，不能承诺“永久免选屏”。不接入尚未稳定发布的该接口；当前应用运行期间复用授权，跨重启仍服从系统确认。输入恢复令牌与屏幕授权是两种不同能力。

## 验证

覆盖取消后重试、重叠请求、关闭后迟到批准、记住/不记住的轨道释放、系统输入拒绝/撤销及令牌轮换；新旧 Electron 的真实原生对比独立于 JS mock。手机触控板与悬浮工具栏有设备测试，并编译真实 APK；设备测试是否实际运行需在交付记录中单列。

参考：[Electron 原生修复 #46112](https://github.com/electron/electron/pull/46112)、[RemoteDesktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)、[RustDesk Wayland 实现](https://github.com/rustdesk/rustdesk/blob/master/libs/scrap/src/wayland/pipewire.rs)。
