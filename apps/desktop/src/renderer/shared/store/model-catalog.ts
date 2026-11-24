import type { ModelsConfigData } from "@preload/api";
import { getDefaultStore } from "jotai";
import { localModelsConfigAtom, modelCatalogSyncErrorAtom, remoteProvidersAtom } from "./model-catalog-atoms";
import { createModelCatalogSync, type ModelCatalogSync } from "./model-catalog-sync";

export { localModelsConfigAtom, modelCatalogSyncErrorAtom } from "./model-catalog-atoms";

function setCatalogSyncError(source: "local" | "remote", failed: boolean, message?: string): void {
	const store = getDefaultStore();
	const current = store.get(modelCatalogSyncErrorAtom);
	if (current[source] === failed && (failed ? current.message === message : true)) return;
	store.set(modelCatalogSyncErrorAtom, {
		...current,
		[source]: failed,
		...(failed && message
			? { message }
			: !failed && !current[source === "local" ? "remote" : "local"]
				? { message: undefined }
				: {}),
	});
}

/**
 * 应用级模型目录同步器：本地 models.json + 远程 provider catalog。
 *
 * 采用 stale-while-revalidate——打开模型 popover、窗口重新获得焦点时按 TTL
 * 后台重拉，先展示旧值再无感替换。这样服务端增删模型后不必重启应用。
 */
const sync = createModelCatalogSync<ModelsConfigData, Record<string, unknown>>({
	now: () => Date.now(),
	loadLocal: () => window.agent567.models.get(),
	applyLocal: (config) => {
		getDefaultStore().set(localModelsConfigAtom, config);
		setCatalogSyncError("local", false);
	},
	loadRemote: async () => {
		// 未登录时主进程直接返回空目录（不发网络请求），写回空表正好与登出行为一致。
		const result = await window.agent567.models.fetchRemote();
		if (result.error && result.error !== "未登录" && result.error !== "unauthorized") throw new Error(result.error);
		return (result.providers ?? {}) as Record<string, unknown>;
	},
	applyRemote: (providers) => {
		getDefaultStore().set(remoteProvidersAtom, providers);
		setCatalogSyncError("remote", false);
	},
	onError: (source, error) => {
		const message = error instanceof Error ? error.message : String(error);
		setCatalogSyncError(source, true, message);
		console.warn(`[modelCatalog] ${source} 目录刷新失败，继续沿用上次结果：`, error);
	},
});

export const modelCatalog: ModelCatalogSync = {
	revalidate: (options) => sync.revalidate(options),
	invalidate: (source) => sync.invalidate(source),
	reset: () => {
		sync.reset();
		getDefaultStore().set(modelCatalogSyncErrorAtom, { local: false, remote: false });
	},
};
