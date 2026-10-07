/**
 * 登录态与接口地址，供 skill 内所有脚本共用。
 *
 * 单独成文件是因为 publish.mjs 与 categories.mjs 必须读同一份凭据、拼同一个前缀：
 * 复制两份的话，哪天客户端换了凭据落盘位置，就会出现「能查分类但传不上去」这种半死状态。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_PREFIX = "/api/v1";

/**
 * 归一 baseUrl 为服务根（不含 API 前缀）。
 *
 * 必须容忍两种写法：桌面端注入的 API567_BASE_URL 自带 /api/v1，旧脚本设
 * API567_BASE_URL 的人通常只写到域名。不统一就会拼出 /api/v1/api/v1/... 而 404。
 */
export function normalizeBaseUrl(raw) {
	return raw.replace(/\/+$/, "").replace(/\/api\/v\d+$/, "");
}

export function apiUrl(baseUrl, path) {
	return `${normalizeBaseUrl(baseUrl)}${API_PREFIX}${path}`;
}

/**
 * 读取登录态。
 *
 * `~/.567agent/auth.json` 是客户端为外部进程下沉的凭据契约，登录、刷新、登出都会同步
 * 它。每次执行都重读，所以 token 轮换后脚本天然拿到新的。
 */
export function loadCredentials() {
	const envToken = process.env.API567_API_TOKEN?.trim();
	const envBase = process.env.API567_BASE_URL?.trim();
	if (envToken && envBase) {
		return { baseUrl: normalizeBaseUrl(envBase), token: envToken };
	}

	const configuredHome = process.env.AGENT567_HOME?.trim();
	const currentAuthPath = join(configuredHome || join(homedir(), ".567agent"), "auth.json");
	const legacyAuthPath = join(configuredHome || join(homedir(), ".vetta"), "auth.json");
	let parsed;
	try {
		const authPath = existsSync(currentAuthPath) ? currentAuthPath : legacyAuthPath;
		parsed = JSON.parse(readFileSync(authPath, "utf8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;

	const token = envToken || (typeof parsed.token === "string" ? parsed.token.trim() : "");
	const baseUrl = envBase || (typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "");
	if (!token || !baseUrl) return null;

	return { baseUrl: normalizeBaseUrl(baseUrl), token };
}
