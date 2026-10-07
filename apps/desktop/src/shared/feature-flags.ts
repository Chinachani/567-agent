/**
 * Feature flags driven by environment variables.
 *
 * Renderer: values are inlined at Vite build/dev start via `vite.config.ts` define.
 * Main: reads `process.env` at runtime (also inlined when present in `.env.<mode>` via main Vite define).
 */

/** 外观设置「界面主题」区段：默认不展示；`AGENT567_SHOW_UI_THEME=true` 时展示。 */
export const APPEARANCE_UI_THEME_ENV = "AGENT567_SHOW_UI_THEME";

export function isAppearanceUiThemeEnabled(): boolean {
	return process.env.AGENT567_SHOW_UI_THEME === "true";
}

/** Windows 本地语音输入：构建期开关，发布后不能由运行环境重新开启。 */
export function isSpeechInputBuildEnabled(): boolean {
	return process.env.AGENT567_SPEECH_INPUT_ENABLED === "true";
}

/** 567 云端能力（账户 / 充值 / 远程模型 / 云市场）：构建期开关。 */
export const CLOUD_ENABLED_ENV = "AGENT567_CLOUD_ENABLED";

/**
 * 云服务是否编入本构建。**默认关闭**（lite / serv-less，开源构建的默认形态）；
 * 只有显式 `AGENT567_CLOUD_ENABLED=true` 才产出接入 567 服务的商业版。
 * cloud 分支经构建期常量折叠后不进产物，发布后不能由运行环境重新开启。
 */
export function isCloudBuildEnabled(): boolean {
	return process.env.AGENT567_CLOUD_ENABLED === "true";
}
