/**
 * 567 Agent API 的云端能力主进程入口（唯一入口）。
 *
 * 宿主只允许通过 `startCloudMain()` 挂载本模块，且必须包在
 * `isCloudBuildEnabled()` 判断里用动态 import 加载——lite 构建
 * （AGENT567_CLOUD_ENABLED=false）经常量折叠后整个模块不进产物。
 *
 * 宿主功能需要云能力（远程模型目录、网关中转、token refresh）时，
 * 一律经 `../cloud-bridge.js` 的 CloudBridge 间接调用，由本入口注入实现。
 */

import { setCloudBridge } from "../cloud-bridge.js";
import { fetchRemoteProviders, registerCloudAuthIpc, tryRefreshAccessToken } from "./auth-session.js";
import { requestVettaGateway } from "./gateway.js";

export function startCloudMain(): void {
	registerCloudAuthIpc();

	// 宿主功能（模型探测回退 / 网关能力 / 市场安装鉴权）经 bridge 使用云服务，
	// 不直接 import cloud 内部实现。
	setCloudBridge({
		fetchRemoteProviders,
		requestGateway: requestVettaGateway,
		tryRefreshAccessToken,
	});
}
