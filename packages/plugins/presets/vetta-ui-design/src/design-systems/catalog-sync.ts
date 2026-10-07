import { readJsonFile, type PluginContext } from "@vetta-org/plugin-sdk";
import { parseRemoteCatalog } from "./remote-catalog";
import { parseStyleKitCatalog } from "./stylekit-catalog";
import { markCatalogFailed, markCatalogLoading, setDesignSystems } from "./registry";
import type { DesignSystem } from "./types";

/**
 * 远端设计资源清单的同步。
 *
 * 数据只来自这里——插件不随包内置任何一套设计体系。所以失败**不能**再静默吞掉：手上
 * 已经有内容时（缓存命中）继续用旧的、不打扰用户；一套都没有时必须把状态标成 failed，
 * 让 UI 给出解释和重试入口，否则用户看到的就是一块无缘无故的空白。
 *
 * 请求预算：缓存在 TTL 内**一个请求都不发**；过期后带 If-None-Match 条件请求，内容没
 * 变时服务端只回 304（几百字节）。所以稳定状态下每个用户每 TTL 最多一次轻量请求。
 */

/**
 * 统一风格库的候选源，按顺序尝试。raw 优先，jsDelivr 仅作回退；两个地址指向同一 catalog。
 * 旧目录缓存仍会在新源不可用时作为迁移期离线回退，但不会再发起旧源或 StyleKit API 请求。
 *
 * 新增地址必须同时加进 plugin.json 的 `network.allowedHosts`（宿主按 host 白名单放行，
 * 且**每一跳重定向都会重新校验**，所以会跳转的地址要把跳转目标也声明上）。
 */
export const STYLE_LIBRARY_CATALOG_SOURCES: readonly string[] = [
	"https://raw.githubusercontent.com/Chinachani/567-agent-style-library/main/.vetta/design-templates.json",
	"https://cdn.jsdelivr.net/gh/Chinachani/567-agent-style-library@main/.vetta/design-templates.json",
];

/** 仅用于已有 StyleKit 缓存的过渡期离线解析。 */
const STYLEKIT_CACHE_KEY = "design-catalog/stylekit.json";

/** 旧版 Vetta 目录缓存，升级离线时用于显示已有风格。 */
const LEGACY_CATALOG_CACHE_KEY = "design-catalog/latest.json";

/** 新版统一风格库缓存，不与旧缓存合并，避免已删除的条目复活。 */
const LIBRARY_CACHE_KEY = "design-catalog/567-style-library.json";

const LEGACY_DESIGN_CATALOG_SOURCE =
	"https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json";

/** 清单在资源仓库中的固定位置。 */
const STYLE_LIBRARY_CATALOG_PATH = ".vetta/design-templates.json";

/**
 * 由清单地址推出仓库根地址。
 *
 * 清单里的资源地址是**相对仓库根**的（`templates/<slug>/...`），而 `new URL(rel, base)`
 * 是相对清单所在目录解析的——直接拿清单地址当 base 会多出一段 `.vetta/`。
 */
export function repoRootUrl(catalogUrl: string): string {
	if (catalogUrl.endsWith(STYLE_LIBRARY_CATALOG_PATH)) {
		return catalogUrl.slice(0, catalogUrl.length - STYLE_LIBRARY_CATALOG_PATH.length);
	}
	try {
		return new URL("./", catalogUrl).toString();
	} catch {
		return catalogUrl;
	}
}

/**
 * 缓存多久之内不再发请求。
 *
 * 定得短（和 raw 的 `max-age=300` 对齐）是因为有 ETag：内容没变时一次检查就是一个
 * 304、零字节，成本可以忽略；只有真的变了才会下载那 300 多 KB。用一个长 TTL 去省这点
 * 开销，换来的是「明明推上去了却要等半天/要手动点刷新」——那才是真正的代价。
 */
const REFRESH_TTL_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

interface CachedCatalog {
	/** 原样存下的清单对象，下次启动直接复用。 */
	catalog: unknown;
	fetchedAt: string;
	/** 这份缓存来自哪个源，以及它的 ETag——只对同一个源做条件请求。 */
	sourceUrl?: string;
	etag?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asCache(value: unknown): CachedCatalog | null {
	if (!isRecord(value)) return null;
	if (typeof value.fetchedAt !== "string") return null;
	return value as unknown as CachedCatalog;
}

/** 缓存是否还在 TTL 内（在的话这一轮完全不联网）。 */
export function isCacheFresh(fetchedAt: string, now: number, ttlMs: number = REFRESH_TTL_MS): boolean {
	const stamp = Date.parse(fetchedAt);
	if (!Number.isFinite(stamp)) return false;
	const age = now - stamp;
	// 时钟回拨会让 age 为负；这种情况按「已过期」处理，宁可多发一次请求。
	return age >= 0 && age < ttlMs;
}

/** 响应头大小写不固定，取值时统一小写匹配。 */
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const hit = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
	return hit?.[1];
}

/** 依次尝试统一目录镜像；成功则整体替换列表并写新版缓存。 */
async function applyLibrary(ctx: PluginContext, cached: CachedCatalog | null, now: number): Promise<boolean> {
	for (const url of STYLE_LIBRARY_CATALOG_SOURCES) {
		try {
			// ETag 只在同源之间有意义：换了源，服务端不认识上一个源发的标识。
			const conditional = cached?.sourceUrl === url && cached.etag ? { "if-none-match": cached.etag } : null;
			const response = await ctx.network.request<unknown>({
				url,
				method: "GET",
				responseType: "json",
				timeoutMs: REQUEST_TIMEOUT_MS,
				// 宿主的 capability 层按 JSON 值校验入参，值为 undefined 的键会被判非法而整个
				// 请求失败。可选字段只能「不带这个键」，不能带一个 undefined。
				...(conditional ? { headers: conditional } : {}),
			});

			// 内容没变：不重新解析，只把「刚查过」记下来，下一个 TTL 周期前不再打扰。
			if (response.status === 304 && cached) {
				await ctx.storage
					.writeFile(LIBRARY_CACHE_KEY, JSON.stringify({ ...cached, fetchedAt: new Date(now).toISOString() }, null, 2), "utf8")
					.catch(() => {});
				return true;
			}
			if (!response.ok) continue;

			const parsed = parseRemoteCatalog(response.body, repoRootUrl(url));
			if (!parsed) continue;
			if (!setDesignSystems(parsed.systems)) continue;
			await ctx.storage
				.writeFile(LIBRARY_CACHE_KEY, JSON.stringify({
					catalog: response.body,
					fetchedAt: new Date(now).toISOString(),
					sourceUrl: url,
					etag: headerValue(response.headers, "etag"),
				} satisfies CachedCatalog, null, 2), "utf8")
				.catch(() => {});
			return true;
		} catch {
			// 单个源失败继续试下一个；全失败就保持现状。
		}
	}
	return false;
}

/**
 * 刷新设计体系列表。调用方不需要 await 或 try/catch：失败会被记进 registry 的 status，
 * 由 UI 呈现，不从这里抛出去。
 *
 * `now` 是本轮唯一的时间源：新鲜度判断和写回的 `fetchedAt` 必须来自同一个读数，
 * 否则「刚写的缓存」可能立刻被判成过期。
 */
export interface RefreshOptions {
	/**
	 * 跳过 TTL 强制联网。用户主动点刷新时用——他要的就是「现在去看有没有新的」，
	 * 这时再拿缓存周期挡住他就是在跟他对着干。
	 */
	force?: boolean;
}

export async function refreshDesignCatalog(
	ctx: PluginContext,
	now: number = Date.now(),
	options: RefreshOptions = {},
): Promise<void> {
	markCatalogLoading();
	let cached: CachedCatalog | null = null;
	try {
		cached = asCache(await readJsonFile<CachedCatalog>(ctx.storage, LIBRARY_CACHE_KEY));
	} catch {
		cached = null;
	}

	let hasUsableCatalog = false;
	if (cached) {
		const parsed = parseRemoteCatalog(cached.catalog, repoRootUrl(cached.sourceUrl ?? STYLE_LIBRARY_CATALOG_SOURCES[0]));
		if (parsed) {
			setDesignSystems(parsed.systems);
			hasUsableCatalog = true;
			// 缓存还新鲜就到此为止：这是把请求量从「每次启动」压到「每 TTL 一次」的关键。
			// 用户主动刷新时例外——先用缓存渲染避免白屏，但一定要去问一次最新的。
			if (!options.force && isCacheFresh(cached.fetchedAt, now)) return;
		} else {
			// 缓存内容已经不可用（格式变了/坏了），别拿它的 ETag 去做条件请求。
			cached = null;
		}
	}

	// 统一库首次联网之前先恢复旧版本缓存，避免升级后离线启动时列表突然变空。
	// 这是只读迁移回退；一旦统一库可用就整体替换，不再把旧 StyleKit 列表并回去。
	if (!hasUsableCatalog) {
		const legacySystems: DesignSystem[] = [];
		try {
			const legacy = asCache(await readJsonFile<CachedCatalog>(ctx.storage, LEGACY_CATALOG_CACHE_KEY));
			if (legacy) {
				const parsed = parseRemoteCatalog(
					legacy.catalog,
					repoRootUrl(legacy.sourceUrl ?? LEGACY_DESIGN_CATALOG_SOURCE),
				);
				if (parsed) legacySystems.push(...parsed.systems);
			}
		} catch {
			// 迁移缓存损坏时继续尝试 StyleKit 的旧缓存。
		}
		try {
			const legacy = asCache(await readJsonFile<CachedCatalog>(ctx.storage, STYLEKIT_CACHE_KEY));
			const systems = legacy ? parseStyleKitCatalog(legacy.catalog) : null;
			if (systems) legacySystems.push(...systems);
		} catch {
			// 迁移缓存损坏时仍可请求统一目录。
		}
		if (legacySystems.length > 0) {
			setDesignSystems(mergeSystems([], legacySystems));
			hasUsableCatalog = true;
		}
	}

	const remoteApplied = await applyLibrary(ctx, cached, now);
	if (!remoteApplied && !hasUsableCatalog) markCatalogFailed();
}

function mergeSystems(current: readonly DesignSystem[], incoming: readonly DesignSystem[]): DesignSystem[] {
	const byId = new Map(current.map((system) => [system.id, system]));
	for (const system of incoming) byId.set(system.id, system);
	return [...byId.values()];
}
