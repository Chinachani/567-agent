# ADR-0167：手机远控的手势、输入释放与画质恢复

状态：已实现于工作树。静态检查和编译的范围见本次交付记录；操作手感与弱网效果仍需真机验收。

## 对照范围

参考 [RustDesk 固定版本 669cb8ac](https://github.com/rustdesk/rustdesk/tree/669cb8ac62aa20d3626395877d7dd0357aec7ed2)。下列链接都指向同一份源码。567 使用 Compose、Electron、WebRTC 和已有的配对机制，交互与算法在这些边界内独立实现，没有引入 RustDesk 的代码、素材或服务。

| 用户操作 | RustDesk 的依据 | 567 的决定与代码入口 |
| --- | --- | --- |
| 点击、右击、按住拖动 | [手机手势说明与模式选择](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/mobile/widgets/gesture_help.dart#L96) | Android `RemoteTouchLayer` 在同一接触序列区分移动、双指轻点、滚动和捏合；`RemoteMouseButton` 管工具栏按压，`RemotePointerInput` 让工具栏与画布共用鼠标状态。切换输入模式会释放在途按键。 |
| 放大后移动光标 | [光标位置、可见矩形及平移](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/models/model.dart#L3360) | 全屏触控板在主机接受绝对坐标时，根据缩放后的画面、键盘遮挡及当前光标计算偏移；光标进入边缘 10% 才平移，不挪动远端坐标。相对输入主机的真实光标未知，保留手动三指平移。平板直接点按模式不自动挪画面。见 `RemoteViewport.kt` 和 `RemoteDesktopSurface.android.kt`。 |
| 系统键盘打开或收起 | [软键盘可见性](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/mobile/pages/remote_page.dart#L286)、[输入焦点](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/mobile/pages/remote_page.dart#L465) | `RemoteFullscreenLayout` 固定视频，只有文字控制区避让输入法；编辑时仍可点电脑，画布不抢手机输入焦点。系统键盘显示再隐藏时收回文字工具，未发草稿留在手机。连接了实体键盘时不要求输入法必须出现。 |
| 长按期间断开、撤权或替换观看者 | [主机记录和释放远程按键](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/src/server/input_service.rs#L1001)、[macOS 拖动事件](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/libs/enigo/src/macos/macos_impl.rs#L551) | 渲染进程的 `RemoteInputOwnership` 按路线持有输入，最后一个持有者退出才发送松开；支持同步注入的主机另存实际交给适配器的按下事件，撤权时先释放再关闭。Wayland 由 portal 会话管理注入生命周期。重新选屏失败或隐藏渲染进程丢失时也释放；异常崩溃每五分钟最多重建一次该隐藏页面，需重新同意共享。Mac 移动时区分按住左、右、中键；Windows 与 X11 分别换算横纵滚轮。 |
| 看到“已连接”，却没有画面或控制请求无回应 | [计时检测与重连](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/models/model.dart#L896)、[失败退避](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/flutter/lib/models/model.dart#L1096) | `NativeRemoteDesktopSession` 将等待选屏、媒体连通等待首帧和正在接收分开。等待首帧满 8 秒提供手动重连；输入需要授权及已显示的首帧。另一路电脑会话控制连接在事件缺口补传满 8 秒仍未恢复时重建；连续失败退避继承至下个连接，上限 30 秒，在线复位。不重放用户操作。 |
| 画面从滚动转为静止文字 | [区分路径延迟与新增延迟、逐步回升](https://github.com/rustdesk/rustdesk/blob/669cb8ac62aa20d3626395877d7dd0357aec7ed2/src/server/video_qos.rs#L98) | WebRTC 继续管理码率。本地 `ScreenStatsSampler` 只比较同一路径最近 30 秒、最多 32 个 RTT 样本；`ScreenAdaptation` 对运动画面结合发送队列判断，长期高但稳定的 RTT 本身不触发降档。静止画面在可用带宽、RTT、编码与发送压力满足条件 20 秒后每次试升一档。手机测量来自视频实际选用的线路；抖动或解码计数缺失时不显示伪造的延迟值。 |

## 边界与验收

1.6.3 开发版根据横屏反馈修订了上表中的键盘交互：右侧浮钮只在展开时显示操作栏，鼠标键在另一侧独立悬浮。主键盘入口默认以 Android `InputConnection` 接收手机输入法确认的文字；勾选「使用文字输入框」后沿用本地草稿流程。键盘期间从打开前的视角和实际遮挡高度计算临时平移；视频尺寸和坐标映射仍共用同一视口。

手指坐标和原生操作系统输入仍使用经过授权的显示器映射；窗口共享不据尺寸猜坐标。自动跟随仅用于手机本次发出的绝对光标，无法得知电脑前用户同时移动鼠标后的实际落点。首帧提示不是媒体断线判定；统计值不是按下到屏幕响应的端到端延迟。Android 软键盘、WebRTC 编码器和系统桌面均可能有设备差异。

1.6.4 的鼠标面板默认为右下角。鼠标、键盘入口、操控栏和两种输入面板各自保存相对于可用空间的二维位置；系统输入法本体仍由 Android 管理。拖动横纹不发送远程按键；尺寸和输入法边距变化后，控件保持在可见区域。

下一轮真机验收应覆盖：Windows/X11 横向滚动，macOS 选中文字拖动；抬起前切后台、断网或撤权；Gboard/厂商输入法开合与实体键盘；弱网降档后停在小字页面，对照统计和实际截图确认回升。当前没有以源码或编译结果代替这些实测。
