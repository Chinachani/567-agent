import type { MediaProviderDescriptor } from "@vetta-org/capability-sdk";
import { ipcMain, type WebContents } from "electron";
import { parseFile } from "music-metadata";
import type { AudioMetadata } from "../../preload/api-types/media.js";
import type { CustomImageProviderResult } from "../../shared/custom-image-providers.js";
import { getDesktopMediaRuntime } from "../capabilities/media-providers.js";
import {
	CustomImageProviderError,
	isCustomImageProviderId,
	parseCustomImageProviderInput,
} from "../media-generation/custom-image-provider-config.js";
import { assertPathReadableForPreview } from "./fs.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

const CHANNELS = {
	LIST_PROVIDERS: "vetta:media:list-providers",
	AUDIO_METADATA: "vetta:media:audio-metadata",
	CUSTOM_LIST: "vetta:media:custom-image-providers:list",
	CUSTOM_SAVE: "vetta:media:custom-image-providers:save",
	CUSTOM_REMOVE: "vetta:media:custom-image-providers:remove",
} as const;

/**
 * 音频元数据解析（黑胶播放器，见 CONTEXT.md「黑胶播放器」）：
 * 内嵌封面（ID3 APIC / FLAC picture）+ 标题/艺术家。在主进程解析，
 * 渲染进程只拿到一张小封面 DataURL 而非整个音频文件。
 */
export function registerMediaIpc(owner: WebContents): () => void {
	ipcMain.handle(CHANNELS.LIST_PROVIDERS, (): MediaProviderDescriptor[] => {
		try {
			return getDesktopMediaRuntime().providers.listProviders();
		} catch {
			return [];
		}
	});
	const run = <T>(action: () => T): CustomImageProviderResult<T> => {
		try {
			return { ok: true, value: action() };
		} catch (error) {
			return { ok: false, error: error instanceof CustomImageProviderError ? error.code : "store-unavailable" };
		}
	};
	ipcMain.handle(CHANNELS.CUSTOM_LIST, (event) => {
		assertTrustedMainRenderer(event, owner);
		return run(() => getDesktopMediaRuntime().customImageProviders.list());
	});
	ipcMain.handle(CHANNELS.CUSTOM_SAVE, (event, input: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return run(() => getDesktopMediaRuntime().customImageProviders.save(parseCustomImageProviderInput(input)));
	});
	ipcMain.handle(CHANNELS.CUSTOM_REMOVE, (event, id: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return run(() => {
			if (!isCustomImageProviderId(id)) throw new CustomImageProviderError("not-found", "Invalid service ID");
			getDesktopMediaRuntime().customImageProviders.remove(id);
			return null;
		});
	});

	ipcMain.handle(CHANNELS.AUDIO_METADATA, async (_event, filePath: unknown): Promise<AudioMetadata> => {
		if (typeof filePath !== "string" || filePath.trim().length === 0) {
			throw new Error("Invalid filePath");
		}
		assertPathReadableForPreview(filePath);
		try {
			// duration 留给 <audio> 元素自己上报，跳过可避免部分格式的全文件扫描
			const metadata = await parseFile(filePath, { duration: false });
			const picture = metadata.common.picture?.[0];
			return {
				title: metadata.common.title ?? undefined,
				artist: metadata.common.artist ?? undefined,
				coverDataUrl: picture
					? `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`
					: undefined,
			};
		} catch {
			// 解析失败不阻断播放：渲染端降级为纯 CSS 盘面 + 文件名
			return {};
		}
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.LIST_PROVIDERS);
		ipcMain.removeHandler(CHANNELS.AUDIO_METADATA);
		ipcMain.removeHandler(CHANNELS.CUSTOM_LIST);
		ipcMain.removeHandler(CHANNELS.CUSTOM_SAVE);
		ipcMain.removeHandler(CHANNELS.CUSTOM_REMOVE);
	};
}
