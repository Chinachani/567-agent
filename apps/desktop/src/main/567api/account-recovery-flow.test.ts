import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewApiService } from "./newapi-service.js";

const network = vi.hoisted(() => ({
	calls: [] as string[],
	refreshMessage: "Cookie 已过期",
	refreshStatus: 401,
	loginRejected: true,
	secureStorageAvailable: true,
}));

vi.mock("node:https", async () => {
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	return {
		default: {
			request: (
				url: URL,
				options: { headers: Record<string, string> },
				receive: (response: IncomingMessage) => void,
			) => {
				const request = new EventEmitter();
				return Object.assign(request, {
					write: () => {},
					destroy: (error: Error) => request.emit("error", error),
					end: () => {
						network.calls.push(url.pathname);
						const isRefresh = url.pathname.endsWith("/refresh");
						const isLogin = url.pathname.endsWith("/login");
						const unauthorized =
							url.pathname.endsWith("/self") && options.headers.Authorization === "Bearer expired";
						const status = isRefresh ? network.refreshStatus : unauthorized ? 401 : 200;
						const payload = isRefresh
							? { success: false, message: network.refreshMessage }
							: unauthorized
								? { success: false }
								: isLogin && network.loginRejected
									? { success: false, message: "password changed" }
									: isLogin
										? {
												success: true,
												data: { access_token: "fresh", user: { username: "user", quota: 500000 } },
											}
										: url.pathname.endsWith("/self")
											? { success: true, data: { quota: 500000 } }
											: { success: true, data: {} };
						const response = Object.assign(new PassThrough(), {
							statusCode: status,
							headers: isLogin ? { "set-cookie": ["session=fresh"] } : {},
						});
						queueMicrotask(() => {
							receive(response as unknown as IncomingMessage);
							response.end(JSON.stringify(payload));
						});
					},
				});
			},
		},
	};
});

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
	safeStorage: {
		isEncryptionAvailable: () => network.secureStorageAvailable,
		getSelectedStorageBackend: () => "gnome_libsecret",
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
}));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: async () => ({ providers: {} }),
		replaceConfig: async () => {},
	}),
}));

describe("account balance recovery through the desktop service", () => {
	let root: string;
	let service: NewApiService;
	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		root = mkdtempSync(join(tmpdir(), "567-account-recovery-"));
		vi.stubEnv("VETTA_HOME", root);
		network.calls = [];
		network.refreshMessage = "Cookie 已过期";
		network.refreshStatus = 401;
		network.loginRejected = true;
		network.secureStorageAvailable = true;
		const { encryptSecret } = await import("./security.js");
		writeFileSync(
			join(root, "567api-session.json"),
			JSON.stringify({
				isLoggedIn: true,
				authType: "account",
				username: "user",
				accessToken: encryptSecret("expired"),
				cookie: encryptSecret("expired-cookie"),
			}),
		);
		const { getDesktopCredentialVault } = await import("../credentials/desktop-credential-vault.js");
		const { saveAccountCredentials } = await import("./account-credentials.js");
		saveAccountCredentials(getDesktopCredentialVault(), { username: "user", password: "old" });
		const module = await import("./newapi-service.js");
		service = module.NewApiService.getInstance();
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	});

	it("preserves account data and stops repeated failed automatic logins until manual login succeeds", async () => {
		expect(await service.refreshQuota(true)).toEqual({ success: false });
		expect(service.getRawSession().isLoggedIn).toBe(true);
		expect(network.calls.filter((path) => path.endsWith("/login"))).toHaveLength(1);
		const callsAfterFailure = network.calls.length;
		for (let i = 0; i < 3; i++) expect(await service.refreshQuota(true)).toEqual({ success: false });
		expect(network.calls).toHaveLength(callsAfterFailure);
		network.loginRejected = false;
		expect(await service.loginWithPassword("user", "new")).toEqual({ success: true });
		expect(await service.refreshQuota(true)).toEqual({ success: true, quota: 500000, quotaUsd: 1 });
	});

	it("does not use a saved password for an invalid-parameter refresh response", async () => {
		network.refreshStatus = 400;
		network.refreshMessage = "参数无效，请重新登录后检查";
		expect(await service.refreshQuota(true)).toEqual({ success: false });
		expect(network.calls.some((path) => path.endsWith("/login"))).toBe(false);
	});

	it("preserves encrypted session data when the OS keyring is temporarily unavailable", async () => {
		const path = join(root, "567api-session.json");
		const savedContents = readFileSync(path, "utf8");
		network.secureStorageAvailable = false;
		vi.resetModules();
		try {
			const module = await import("./newapi-service.js");
			const recoveredService = module.NewApiService.getInstance();
			expect(recoveredService.getRawSession().isLoggedIn).toBe(false);
			expect(readFileSync(path, "utf8")).toBe(savedContents);
		} finally {
			network.secureStorageAvailable = true;
		}
	});

	it("does not let image preferences overwrite an encrypted session when keyring access is unavailable", async () => {
		vi.resetModules();
		network.secureStorageAvailable = true;
		const { encryptSecret } = await import("./security.js");
		const sessionPath = join(root, "567api-session.json");
		writeFileSync(
			sessionPath,
			JSON.stringify({
				isLoggedIn: true,
				authType: "account",
				username: "user",
				accessToken: encryptSecret("still-valid-token"),
				cookie: encryptSecret("still-valid-cookie"),
			}),
		);
		const originalSession = readFileSync(sessionPath, "utf8");
		network.secureStorageAvailable = false;

		const { NewApiService: ReloadedNewApiService } = await import("./newapi-service.js");
		const recoveringService = ReloadedNewApiService.getInstance();
		expect(await recoveringService.setImageGroup("images")).toMatchObject({ success: false });
		expect(await recoveringService.setImageModel("image-model")).toMatchObject({ success: false });
		expect(readFileSync(sessionPath, "utf8")).toBe(originalSession);
	});
});
