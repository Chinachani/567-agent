import { Buffer } from "node:buffer";
import { type ImageResizeOptions, type ImageResizeResult, resizeImageBuffer } from "./tools/read/image-resize.js";

type ResizeImageBuffer = (
	bytes: Buffer,
	mimeType: string,
	options: ImageResizeOptions | undefined,
	originalBase64: string,
) => Promise<ImageResizeResult>;

export interface NodeModelInputImageProcessorOptions {
	readonly resize?: ResizeImageBuffer;
	/** 最多记住的处理结果条数；同一张图在一轮的每次模型调用中都会重复出现。 */
	readonly maxEntries?: number;
	/** Budget includes source strings and processed image strings. */
	readonly maxBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Node adapter for Coding Agent's structurally typed model-input image processor port.
 *
 * 结果按「原图 base64 + mimeType + 缩放参数」记忆：每次模型调用都会重新规范化整段历史里的图片，
 * 不记忆时超限图片每一步都要在主进程里同步重新缩放。base64 字符串本身作为键，相同消息对象复用同一字符串，比较开销很小。
 */
export function createNodeModelInputImageProcessor(options: NodeModelInputImageProcessorOptions = {}) {
	const resize = options.resize ?? resizeImageBuffer;
	const maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
	const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES);
	const cache = new Map<
		string,
		{ variant: string; data: string; result: Promise<ImageResizeResult>; bytes: number }
	>();
	let bytes = 0;
	let sequence = 0;
	function forget(key: string): void {
		const entry = cache.get(key);
		if (!entry) return;
		bytes -= entry.bytes;
		cache.delete(key);
	}
	function trim(): void {
		while (cache.size > maxEntries || bytes > maxBytes) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			forget(oldest);
		}
	}

	return {
		async resize(
			data: string,
			mimeType: string,
			signal: AbortSignal,
			resizeOptions?: ImageResizeOptions,
		): Promise<ImageResizeResult> {
			signal.throwIfAborted();
			const variant = `${mimeType}\n${JSON.stringify(resizeOptions ?? null)}`;
			for (const [key, entry] of cache) {
				if (entry.variant !== variant || entry.data !== data) continue;
				cache.delete(key);
				cache.set(key, entry);
				const value = await entry.result;
				signal.throwIfAborted();
				return value;
			}
			const result = Promise.resolve().then(() =>
				resize(Buffer.from(data, "base64"), mimeType, resizeOptions, data),
			);
			const key = String(sequence++);
			const entry = { variant, data, result, bytes: data.length * 2 };
			cache.set(key, entry);
			bytes += entry.bytes;
			trim();
			try {
				const value = await result;
				if ("failed" in value) {
					forget(key);
					signal.throwIfAborted();
					return value;
				}
				if (cache.get(key) === entry) {
					const outputBytes = value.data === data ? 0 : value.data.length * 2;
					entry.bytes += outputBytes;
					bytes += outputBytes;
					trim();
				}
				signal.throwIfAborted();
				return value;
			} catch (error) {
				forget(key);
				throw error;
			}
		},
	};
}

export const nodeModelInputImageProcessor = createNodeModelInputImageProcessor();
