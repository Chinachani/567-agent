/**
 * 567 Agent API 云能力 UI 挂载点（宿主侧）。
 *
 * 宿主代码一律从这里取云服务组件，不得静态 import `@cloud/**`：
 * 本文件用构建期常量 + 动态 import 隔离 cloud chunk，lite 构建
 * （AGENT567_CLOUD_ENABLED=false）下各槽位恒渲染 null 且不打包 cloud 代码。
 */

import { isCloudBuildEnabled } from "@/shared/feature-flags";
import { lazy, Suspense } from "react";

/** 云服务是否编入本构建。宿主 UI 需要按形态增减入口时读它。 */
export const cloudEnabled = isCloudBuildEnabled();

const LazyAuthBoot = cloudEnabled
	? lazy(() => import("@cloud/auth/mount").then((m) => ({ default: m.CloudAuthBoot })))
	: null;

/** NewAPI 会话生命周期（本地 token 恢复 / refresh / SSE / 订阅）。挂在 App 根部，只挂一次。 */
export function CloudAuthBoot(): JSX.Element | null {
	if (!LazyAuthBoot) return null;
	return (
		<Suspense fallback={null}>
			<LazyAuthBoot />
		</Suspense>
	);
}
