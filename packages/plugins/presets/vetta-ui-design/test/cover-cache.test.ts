import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const raw =
	"https://raw.githubusercontent.com/Chinachani/567-agent-style-library/main/assets/stylekit/editorial/cover.svg";
const cdn = "https://cdn.jsdelivr.net/gh/Chinachani/567-agent-style-library@main/assets/stylekit/editorial/cover.svg";
const body = btoa('<svg xmlns="http://www.w3.org/2000/svg"><text>Editorial</text></svg>');

function fixture() {
	const files = new Map<string, string>();
	const network = vi.fn(async (_request: { url: string }) => ({
		ok: true,
		headers: { "content-type": "image/svg+xml" },
		body,
	}));
	const ctx = {
		network: { request: network },
		storage: {
			readFile: async (path: string) => {
				if (!files.has(path)) throw new Error("missing");
				return files.get(path);
			},
			writeFile: async (path: string, text: string) => {
				files.set(path, text);
			},
		},
	} as unknown as PluginContext;
	return { ctx, files, network };
}

beforeEach(() => vi.resetModules());

describe("design cover downloads", () => {
	it("limits concurrent downloads and lets queued covers continue as slots become available", async () => {
		const f = fixture();
		const pending: Array<() => void> = [];
		let active = 0;
		let peak = 0;
		f.network.mockImplementation(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise<void>((resolve) => pending.push(resolve));
			active--;
			return { ok: true, headers: { "content-type": "image/svg+xml" }, body };
		});
		const { loadDesignCover } = await import("../src/design-systems/cover-cache");
		const downloads = Array.from({ length: 5 }, (_, index) => loadDesignCover(f.ctx, `${raw}?cover=${index}`));
		await vi.waitFor(() => expect(f.network).toHaveBeenCalledTimes(4));
		pending.shift()?.();
		await vi.waitFor(() => expect(f.network).toHaveBeenCalledTimes(5));
		for (const resolve of pending) resolve();
		expect((await Promise.all(downloads)).every((source) => source?.startsWith("data:image/svg+xml"))).toBe(true);
		expect(peak).toBe(4);
	});

	it("falls back to the library mirror and can reopen from disk with zero network calls", async () => {
		const f = fixture();
		f.network.mockRejectedValueOnce(new Error("connection closed"));
		const { loadDesignCover } = await import("../src/design-systems/cover-cache");
		expect(await loadDesignCover(f.ctx, raw)).toBe(`data:image/svg+xml;base64,${body}`);
		expect(f.network.mock.calls.map((call) => (call[0] as { url: string }).url)).toEqual([raw, cdn]);
		vi.resetModules();
		f.network.mockClear().mockRejectedValue(new Error("offline"));
		const reopened = await import("../src/design-systems/cover-cache");
		expect(await reopened.loadDesignCover(f.ctx, raw)).toBe(`data:image/svg+xml;base64,${body}`);
		expect(f.network).not.toHaveBeenCalled();
	});

	it("retries after a failed download instead of retaining a permanent empty cover", async () => {
		const f = fixture();
		f.network.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
		const { loadDesignCover } = await import("../src/design-systems/cover-cache");
		expect(await loadDesignCover(f.ctx, raw)).toBeNull();
		expect(await loadDesignCover(f.ctx, raw)).toContain("data:image/svg+xml");
	});

	it("accepts a plain-text SVG but rejects a mirror error page", async () => {
		const f = fixture();
		f.network.mockResolvedValue({ ok: true, headers: { "content-type": "text/plain" }, body });
		const { loadDesignCover } = await import("../src/design-systems/cover-cache");
		expect(await loadDesignCover(f.ctx, raw)).toContain("data:image/svg+xml");
		f.network.mockResolvedValue({
			ok: true,
			headers: { "content-type": "text/plain" },
			body: btoa("<html>Not found</html>"),
		});
		expect(await loadDesignCover(f.ctx, `${raw}?new=1`)).toBeNull();
	});
});
