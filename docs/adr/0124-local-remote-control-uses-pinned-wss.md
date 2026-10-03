---
status: accepted
---

# 局域网远程控制使用证书固定的 WSS

## 背景

桌面端局域网中继原先监听明文 HTTP/WebSocket，并允许任何局域网客户端先占用配对角色。邀请链接带有配对凭据，因此明文传输可能泄露凭据，也无法可靠识别桌面端。

## 决策

- 桌面端为本地中继生成自签 TLS 证书，私钥通过桌面系统凭据库加密保存。
- 配对邀请继续包含云端中继，并为 LAN 地址携带证书 SHA-256 指纹。Android 仅在 HTTPS/WSS 与指纹有效时尝试 LAN；不支持新格式的旧邀请仍可通过云端中继连接。
- Android 控制和屏幕信令 WebSocket 都固定到邀请中的证书指纹。桌面 Node 客户端信任同一证书，隐藏 Chromium session 只在目标 WebSocket origin 与证书指纹同时匹配时接受本地自签证书。
- 桌面端同时连接邀请对应的云端 WSS 和本地证书固定 WSS。Android 优先尝试已固定指纹的 LAN 地址，失败后回退云端；桌面为两条信令链路分别建立屏幕连接，任一链路断开时独立重连。
- 本地中继在升级 WebSocket 前校验配对 ID 和对应角色的配对凭据。首次 bootstrap 绑定的 resume secret 加密保存在桌面凭据库中，以便桌面重启后恢复配对。

## 后果

邀请 URI 增加 `lanFingerprint` 参数。已有邀请不会再使用明文 LAN 地址；要继续 LAN 直连，用户需重新生成并扫描配对邀请。更换或撤销配对会移除本地 resume secret。
