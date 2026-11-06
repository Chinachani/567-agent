import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { allowProjectRoot } from "../filesystem/filesystem-service.js";
import { MediaArtifactStore } from "./media-artifact-store.js";
import { createOpenAiCompatibleImageProvider } from "./openai-compatible-image-provider.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const KEY = "sk-private-example";
const config = {
	id: "test",
	name: "Images",
	baseUrl: "https://images.example/v1",
	model: "image-model",
	supportsTextToImage: true,
	supportsImageToImage: true,
};
const input = {
	operation: "generate" as const,
	kind: "image" as const,
	mode: "text-to-image" as const,
	prompt: "test",
	inputs: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("OpenAI-compatible image transport", () => {
	let directory: string;
	let store: ArtifactStore;
	let artifacts: MediaArtifactStore;
	const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
	const createProvider = () => createOpenAiCompatibleImageProvider(artifacts, config, () => KEY, fetch);
	const context = () => ({ ownerId: "image-gen", signal: new AbortController().signal });
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "agent567-image-transport-"));
		allowProjectRoot(directory);
		store = new ArtifactStore({ root: join(directory, "artifacts") });
		artifacts = new MediaArtifactStore(store);
		fetch.mockReset();
	});
	afterEach(() => {
		store.dispose();
		rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	it.each([
		["https://images.example/result.png", true],
		["/result.png", true],
		["https://cdn.example/result.png", false],
	])("downloads %s with credentials limited to the configured origin", async (url, authenticated) => {
		fetch
			.mockResolvedValueOnce(json({ data: [{ url }] }))
			.mockResolvedValueOnce(new Response(Buffer.from(PNG, "base64")));
		const job = await createProvider().submit(input, context());
		expect(job.status).toBe("succeeded");
		expect(job.artifacts?.[0]).toMatchObject({ kind: "image", mimeType: "image/png" });
		expect(fetch.mock.calls.map(([, init]) => init.redirect)).toEqual(["error", "error"]);
		expect(fetch.mock.calls[1][1].headers).toEqual(authenticated ? { Authorization: `Bearer ${KEY}` } : {});
	});

	it.each([
		{ data: [null] },
		{ data: [{ b64_json: "<script>not an image</script>" }] },
		{ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] },
		{ data: [{ b64_json: Buffer.from("RIFF1234WAVEfmt ").toString("base64") }] },
		{ data: [{ url: "file:///etc/passwd" }] },
		{ data: [{ url: "https://name:password@example.com/a.png" }] },
	])("rejects malformed image results without creating artifacts: %j", async (body) => {
		fetch.mockResolvedValueOnce(json(body));
		const job = await createProvider().submit(input, context());
		expect(job.status).toBe("failed");
		expect(job.artifacts).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("accepts WebP only with its RIFF WEBP signature", async () => {
		const webp = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
		fetch.mockResolvedValueOnce(json({ data: [{ b64_json: webp }] }));
		const job = await createProvider().submit(input, context());
		expect(job.status).toBe("succeeded");
		expect(job.artifacts?.[0]).toMatchObject({ kind: "image", mimeType: "image/webp" });
	});

	it("enforces both advertised and streamed download limits", async () => {
		for (const advertised of [true, false]) {
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					if (!advertised) controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1));
				},
				cancel() {
					cancelled = true;
				},
			});
			fetch
				.mockResolvedValueOnce(json({ data: [{ url: "https://cdn.example/out.png" }] }))
				.mockResolvedValueOnce(
					new Response(body, { headers: advertised ? { "content-length": String(32 * 1024 * 1024 + 1) } : {} }),
				);
			const job = await createProvider().submit(input, context());
			expect(job.status).toBe("failed");
			expect(cancelled).toBe(true);
		}
	});

	it("rejects an oversized reference before reading it or sending a request", async () => {
		const path = join(directory, "large.png");
		writeFileSync(path, "");
		truncateSync(path, 32 * 1024 * 1024 + 1);
		const job = await createProvider().submit(
			{
				...input,
				mode: "image-to-image",
				inputs: [{ kind: "image", mimeType: "image/png", source: { type: "workspace-file", path } }],
			},
			context(),
		);
		expect(job.status).toBe("failed");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("returns redacted HTTP errors and propagates cancellation", async () => {
		fetch.mockResolvedValueOnce(json({ error: { message: `Invalid ${KEY}` } }, 401));
		const job = await createProvider().submit(input, context());
		expect(job.error).toMatchObject({ code: "unauthenticated", retryable: false });
		expect(JSON.stringify(job)).not.toContain(KEY);
		const controller = new AbortController();
		fetch.mockImplementationOnce(async (_url, init) => {
			controller.abort();
			init.signal?.throwIfAborted();
			return json({ data: [] });
		});
		await expect(createProvider().submit(input, { ...context(), signal: controller.signal })).rejects.toThrow();
	});
});
