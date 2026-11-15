# ADR-0161：Linux 远控采集进程隔离

状态：已实现，尚未完成原生故障注入与实机验证
日期：2026-11-14

## 背景与证据

1.5.9 在 Linux 的 `desktopCaptureT` 线程发生 SIGSEGV，导致整个主进程退出。
Electron 35.7.5 官方调试文件与安装程序的 ELF Build ID 一致；将内核指令地址换算为
ELF VMA `0x7a5dbad` 后，符号与机器码均指向 WebRTC
`DesktopAndCursorComposer::OnCaptureResult` 中内联的光标合成逻辑。
故障指令读取空图像指针的 `0x18` 偏移；没有完整 core，无法还原产生该光标对象的全部调用链。

JS 异常捕获和另一扇隐藏 BrowserWindow 都无法隔离主进程内的原生崩溃。
当前 Chromium 的窗口、整屏采集都会创建光标合成器，不能确认 `cursor: never`
可绕开它。单独修改轨道保留时间也不能消除该指针错误。
未发现可确认覆盖本次故障的上游版本修复，因而不凭推测升级 Electron，
也不通过禁用 PipeWire 降级 Wayland 共享或修改用户安装的二进制。

## 决策

- Linux 远控的隐藏 BrowserWindow、选屏枚举、原生捕获与 WebRTC 路线放入独立
  Electron 进程。Windows/macOS 沿用原宿主。平台无关 remote-desktop 包不增加宿主依赖，
  也不改变手机线协议、配对身份或现有 host handle。
- 构建入口先判定私有 helper 标志，再通过顶层 await 加载主应用或采集入口。
  共享 IPC 模块独立输出，避免动态入口反向依赖等待中的 bootstrap。
  路由发生在 GUI 的单实例锁、配置恢复及 Runtime 初始化之前，保留正常主应用的 ready 前注册顺序。
- helper 必须同时具备 Node 继承 IPC、Linux 平台和绝对临时目录；独立重启其命令行无法进入采集。
  Chromium userData/sessionData 使用应用 `remote-capture` cache namespace 的独立临时目录，
  退出后仅清理本次目录。父进程断开时 helper 退出，停止超过两秒时父进程强制结束它。
- 配对连接信息仅经继承 IPC 传入，不进入 argv、额外配置文件或诊断日志。
  原生 stdout/stderr 不转发到系统日志，以免原生错误循环刷盘。
  JS 诊断仍使用统一 logger，使用 remote-capture + PID 文件后缀。
- 主进程保留原生确认框、输入适配器、系统输入授权及恢复令牌的所有权。
  helper 只能请求现有类型的选屏确认，发送受校验的来源映射和输入包，
  不能凭消息自行授予输入权限。每代进程、输入授权与异步返回均核对当前身份；
  退出、失联、停止时先撤销输入，迟到授权不能影响恢复后的新进程。
- 维持正常短断线时母轨道复用和已记住设备的自动共享。
  原生进程异常退出后，最多自动重建一次；五分钟内再次退出则停止自动恢复，
  防止崩溃循环。重建后的画面需要重新批准共享，输入仍服从既有用户设置与系统授权。
  停止并重新启用远控宿主可开启新的恢复周期。

## 结果与限制

本次修复的是远控原生采集的故障隔离与收尾，不是对 WebRTC C++ 空指针的补丁。
故障可能中断当前画面，但其 SIGSEGV 不再发生于聊天与主界面所属进程。
其他调用原生采集的独立产品功能不在本次隔离范围内。

多一个 Electron 主进程会增加内存和启动开销；既有配对、屏幕选择和系统授权语义保持。
新进程不读写主应用 Electron profile，不启动聊天 Runtime，也不运行单实例逻辑。
静态类型、架构守卫和构建图可检查入口及依赖；实际原生退出、Linux portal
与跨进程重连仍需行为和实机验证。本次没有执行行为测试或操作用户运行中的客户端。

前序记录：[ADR-0138](0138-wayland-input-and-capture-lifecycle.md)、
[ADR-0160](0160-shared-range-downloads-and-mapped-wayland-input.md)。
