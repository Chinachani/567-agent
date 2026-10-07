/**
 * renderer 侧 567 Agent API 云能力 UI 入口。
 *
 * 宿主只允许经 `@shared/components/cloud-slots` 懒加载本模块——
 * lite 构建（AGENT567_CLOUD_ENABLED=false）经常量折叠后整个 chunk 不进产物，
 * 所以宿主代码不得静态 import `@cloud/**`。
 */

import { useAuth } from "./hooks/useAuth";

/**
 * 云会话生命周期宿主：token 引导、主动 refresh 调度、SSE 连接与订阅拉取
 * 全部挂在这里，整棵 React 树只挂载一次（App 根部）。
 */
export function CloudAuthBoot(): null {
	useAuth();
	return null;
}
