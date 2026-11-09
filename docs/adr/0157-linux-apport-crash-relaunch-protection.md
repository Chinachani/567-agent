# ADR-0157：Linux 安装包隔离 Apport 子进程误重启

- 状态：已实现
- 日期：2026-11-09

## 背景

Ubuntu Apport 收集了 `/opt/567-agent/567-agent --type=zygote --no-zygote-sandbox` 的 SIGSEGV 报告。崩溃提醒可以把 `ProcCmdline` 作为普通程序重启；脱离父进程的 Chromium zygote 缺少 IPC socket，在原生层持续输出 ENOTSOCK，导致 CPU 满载、syslog 暴涨和磁盘写入失败。应用 JavaScript 的日志轮转无法控制这个启动前的原生循环。

## 决策

- DEB/RPM 通过 FPM 的文件映射携带 `/etc/apport/blacklist.d/567-agent`，仅包含精确的 `/opt/567-agent/567-agent`。该路径由当前及旧版 Apport 在收集崩溃报告之前读取；不会禁用系统的 Apport 服务、journald、rsyslog，或影响其他软件。
- 代价是 Apport 不再为这个可执行文件生成新的原生 core 报告。现有应用主进程、Renderer、GPU 退出诊断和文本日志继续保留。不是隐藏 syslog 错误，也不声称修复了最初的驱动/Chromium SIGSEGV。
- 策略由包管理器拥有。应用运行时不提权、不写系统目录，不改系统崩溃脚本、不自动删除已有 crash/syslog。旧报告仍可能被用户主动打开，升级不会清除它们。
- AppImage 不是固定安装路径，不写系统策略；本决策的 Apport 防护限定于固定路径的 DEB/RPM。自定义安装目录需要相应的显式运维策略，不能使用宽泛路径匹配。
- 现有 Linux GPU 软件渲染回退保留两次崩溃阈值，观察窗口从十分钟扩展到滚动二十四小时，最多保存最近两次；窗口内不足两次时恢复硬件尝试。避免相隔几十分钟的同日驱动崩溃永远达不到回退条件。只影响下一次启动，不中断正在运行的会话。
- 发布验证不仅核对策略文件存在，也从实际 DEB/RPM 读取内容，拒绝空策略、错误路径或影响其他应用的多余规则。

## 备选方案

- 在 Electron `main.ts` 拒绝 `--type=zygote`：子进程进入原生代码，不经过应用 JavaScript，无效。
- Apport package/general hook 设置 `RespawnCommand`：仅重启、不上传报告的 UI 路径不保证调用收集 hook，无法完整保护。
- 全局停止 Apport 或降低所有系统日志速率：影响其他应用，且不解决满 CPU 循环，放弃。
- 包装启动脚本：崩溃报告记录真实 Electron 可执行文件，重启会绕过脚本，不能作为充分防护。

## 验证

使用隔离目录生成策略并构造 DEB，生产检查器读取归档中的真实内容；另以本机 Apport 实际解析器在临时目录核对精确匹配与其他程序不受影响。没有安装测试包、触发真实客户端崩溃或修改系统日志。
