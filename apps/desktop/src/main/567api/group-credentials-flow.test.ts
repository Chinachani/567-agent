import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	home: "",
	tokens: [] as Array<{ id: number; status: number; name: string; group: string; key: string }>,
	calls: [] as Array<{ method: string; path: string; body: Record<string, unknown> }>,
	quotaStatus: 200,
	quota: 500000,
	quotaCached: true,
	listFails: false,
	maskedFails: false,
}));
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => fixture.home }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("../agent-runtime/host-services.js", () => ({ refreshSharedModelRouting() {} }));
vi.mock("../models/presets/sync.js", () => ({ listPresetProviders: async () => ({ providers: [] }) }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: async () => JSON.parse(readFileSync(join(fixture.home, "models.json"), "utf8")),
		replaceConfig: async (value: unknown) => writeFileSync(join(fixture.home, "models.json"), JSON.stringify(value)),
	}),
}));
vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
	safeStorage: {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "gnome_libsecret",
		encryptString: (s: string) => Buffer.from(s),
		decryptString: (b: Buffer) => b.toString(),
	},
}));
vi.mock("node:https", async () => {
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	return {
		default: {
			request: (url: URL, options: { method: string }, receive: (response: unknown) => void) => {
				const req = new EventEmitter();
				let payload = "";
				return Object.assign(req, {
					write: (s: string) => {
						payload += s;
					},
					destroy: (error: Error) => req.emit("error", error),
					end: () => {
						const body = payload ? JSON.parse(payload) : {};
						const method = options.method;
						fixture.calls.push({ method, path: url.pathname, body });
						let status = 200;
						let data: unknown;
						if (url.pathname === "/api/user/self") {
							status = fixture.quotaStatus;
							data = { success: status === 200, data: { quota: fixture.quota } };
						} else if (url.pathname === "/api/token/" && method === "POST") {
							const id = fixture.tokens.length + 1;
							fixture.tokens.push({
								id,
								status: 1,
								name: body.name,
								group: body.group || "default",
								key: `sk-fixture-token-${id}-long-enough`,
							});
							data = { success: true };
						} else if (url.pathname === "/api/token/") {
							status = fixture.listFails ? 503 : 200;
							data = { success: status === 200, data: { items: fixture.tokens } };
						} else if (url.pathname.endsWith("/key")) {
							status = fixture.maskedFails ? 503 : 200;
							data = { success: status === 200, data: fixture.tokens[0]?.key };
						} else data = { success: true, data: [{ id: "fixture-chat", context_window: 64000 }] };
						const res = Object.assign(new PassThrough(), { statusCode: status, headers: {} });
						queueMicrotask(() => {
							receive(res);
							res.end(JSON.stringify(data));
						});
					},
				});
			},
		},
	};
});

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
	fixture.home = mkdtempSync(join(tmpdir(), "567-group-credentials-"));
	fixture.tokens = [];
	fixture.calls = [];
	fixture.quotaStatus = 200;
	fixture.quota = 500000;
	fixture.quotaCached = true;
	fixture.listFails = false;
	fixture.maskedFails = false;
	writeFileSync(
		join(fixture.home, "567api-session.json"),
		JSON.stringify({
			isLoggedIn: true,
			accessToken: "fixture-account",
			username: "fixture",
			quota: 500000,
			quotaUsd: 1,
			lastUpdated: new Date().toISOString(),
		}),
	);
	writeFileSync(join(fixture.home, "models.json"), JSON.stringify({ providers: {} }));
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	rmSync(fixture.home, { recursive: true, force: true });
});

it("connects image then default groups with distinct credentials and persists only stable group headers", async () => {
	const { NewApiService } = await import("./newapi-service.js");
	const service = NewApiService.getInstance();
	expect(await service.syncSingleGroup("画图")).toMatchObject({ success: true });
	expect(await service.syncSingleGroup("")).toMatchObject({ success: true });
	const saved = JSON.parse(readFileSync(join(fixture.home, "models.json"), "utf8"));
	expect(saved.providers["567api"].apiKey).not.toBe(saved.providers["567api_image"].apiKey);
	expect(saved.providers["567api"].headers).toEqual({ "X-567-Group": "default" });
	expect(fixture.tokens.map((t) => [t.name, t.group])).toEqual([
		["567 Agent [画图]", "画图"],
		["567 Agent", "default"],
	]);
});

it("never borrows another group's or a user's token when the token limit is reached", async () => {
	fixture.tokens = Array.from({ length: 10 }, (_, i) => ({
		id: i + 1,
		status: 1,
		name: i === 0 ? "567 Agent [画图]" : `User ${i}`,
		group: "画图",
		key: `sk-fixture-art-token-${i}-long-enough`,
	}));
	const { NewApiService } = await import("./newapi-service.js");
	await expect(NewApiService.getInstance().getApiKey()).rejects.toThrow();
	expect(fixture.calls.some((c) => c.method === "PUT" || c.method === "POST")).toBe(false);
});

it("stops after a failed token list or unmask instead of creating duplicate credentials", async () => {
	const { NewApiService } = await import("./newapi-service.js");
	const service = NewApiService.getInstance();
	fixture.listFails = true;
	await expect(service.getApiKey()).rejects.toThrow();
	expect(fixture.calls.some((c) => c.method === "POST" && c.path === "/api/token/")).toBe(false);
	fixture.listFails = false;
	fixture.maskedFails = true;
	fixture.tokens = [{ id: 1, status: 1, name: "567 Agent", group: "default", key: "********" }];
	await expect(service.getApiKey()).rejects.toThrow();
	expect(fixture.calls.some((c) => c.method === "POST" && c.path === "/api/token/")).toBe(false);
});

it.each([true, false])(
	"force refresh honors 429 cooldown with cached quota=%s and resumes after expiry",
	async (cached) => {
		if (!cached)
			writeFileSync(
				join(fixture.home, "567api-session.json"),
				JSON.stringify({ isLoggedIn: true, accessToken: "fixture-account" }),
			);
		const { NewApiService } = await import("./newapi-service.js");
		const service = NewApiService.getInstance();
		fixture.quotaStatus = 429;
		expect(await service.refreshQuota(true)).toMatchObject({ success: false });
		const before = fixture.calls.filter((c) => c.path === "/api/user/self").length;
		for (let i = 0; i < 4; i++) await service.refreshQuota(true);
		expect(fixture.calls.filter((c) => c.path === "/api/user/self")).toHaveLength(before);
		fixture.quotaStatus = 200;
		fixture.quota = 1000000;
		vi.setSystemTime(Date.now() + 120001);
		const result = await Promise.all([service.refreshQuota(true), service.refreshQuota(true)]);
		expect(result).toEqual([
			{ success: true, quota: 1000000, quotaUsd: 2 },
			{ success: true, quota: 1000000, quotaUsd: 2 },
		]);
		expect(fixture.calls.filter((c) => c.path === "/api/user/self")).toHaveLength(before + 1);
	},
);
