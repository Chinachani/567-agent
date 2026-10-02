import { describe, expect, it, vi } from "vitest";
import {
	AccessTokenRefreshCoordinator,
	AccountLoginRejectedError,
	isRefreshCookieRejected,
	RefreshCookieRejectedError,
	refreshWithAccountRecovery,
} from "./access-token-refresh.js";

describe("567 API account token recovery", () => {
	it("backs off repeated refresh failures, retries after cooldown, and resets after success", async () => {
		let now = 0;
		const coordinator = new AccessTokenRefreshCoordinator(() => now);
		const failure = new Error("offline");
		const refresh = vi.fn(async () => {
			throw failure;
		});
		await expect(coordinator.run(refresh)).rejects.toBe(failure);
		now = 29_999;
		await expect(coordinator.run(refresh)).rejects.toBe(failure);
		expect(refresh).toHaveBeenCalledTimes(1);
		now = 30_000;
		await expect(coordinator.run(refresh)).rejects.toBe(failure);
		now = 89_999;
		await expect(coordinator.run(refresh)).rejects.toBe(failure);
		expect(refresh).toHaveBeenCalledTimes(2);
		now = 90_000;
		await expect(coordinator.run(async () => "fresh")).resolves.toBe("fresh");
		await expect(coordinator.run(refresh)).rejects.toBe(failure);
		now = 120_000;
		await expect(coordinator.run(async () => "recovered")).resolves.toBe("recovered");
	});

	it("cools down rejected saved passwords and lets manual login reset recovery", async () => {
		let now = 0;
		const coordinator = new AccessTokenRefreshCoordinator(() => now);
		const login = vi.fn(async () => {
			throw new AccountLoginRejectedError("password changed");
		});
		const recover = () =>
			refreshWithAccountRecovery(
				async () => {
					throw new RefreshCookieRejectedError("expired", 401);
				},
				() => ({ username: "user", password: "old" }),
				login,
			);
		await expect(coordinator.run(recover)).rejects.toThrow("password changed");
		now = 4 * 60_000;
		await expect(coordinator.run(recover)).rejects.toThrow("password changed");
		expect(login).toHaveBeenCalledTimes(1);
		coordinator.reset();
		await expect(coordinator.run(async () => "manual-login-token")).resolves.toBe("manual-login-token");
	});

	it("ignores a stale refresh failure after account recovery was reset", async () => {
		const coordinator = new AccessTokenRefreshCoordinator();
		let rejectOld: ((error: Error) => void) | undefined;
		const old = coordinator.run(
			() =>
				new Promise<string>((_, reject) => {
					rejectOld = reject;
				}),
		);
		await Promise.resolve();
		coordinator.reset();
		await expect(coordinator.run(async () => "new-account")).resolves.toBe("new-account");
		rejectOld?.(new Error("old-account failure"));
		await expect(old).rejects.toThrow("old-account failure");
		await expect(coordinator.run(async () => "fresh")).resolves.toBe("fresh");
	});

	it.each([
		[{ status: 401 }, true],
		[{ status: 200, code: "403" }, true],
		[{ status: 200, message: "登录信息已过期" }, true],
		[{ status: 200, message: "refresh token has expired" }, true],
		[{ status: 200, message: "invalid session" }, true],
		[{ status: 400, message: "参数无效，请重新登录后检查" }, false],
		[{ status: 400, message: "订阅过期" }, false],
		[{ status: 503, message: "session expired" }, false],
		[{ status: 429, code: 401 }, false],
	])("classifies refresh-cookie rejection without treating business errors as logout: %o", (response, expected) => {
		expect(isRefreshCookieRejected(response)).toBe(expected);
	});
	it("retries an unauthorized request after one cookie rejection and password login", async () => {
		const coordinator = new AccessTokenRefreshCoordinator();
		const credentials = { username: "user@example.com", password: "password" };
		let accessToken: string | undefined = "expired";
		const refreshCookie = vi.fn(async () => {
			throw new RefreshCookieRejectedError("expired", 401);
		});
		const passwordLogin = vi.fn(async () => {
			accessToken = "fresh";
			return accessToken;
		});
		const send = vi.fn(async (token: string) => (token === "fresh" ? { status: 200 } : { status: 401 }));

		const initial = await send(accessToken);
		expect(initial.status).toBe(401);
		const nextToken = await coordinator.afterUnauthorized(
			"expired",
			() => accessToken,
			() => {
				accessToken = undefined;
			},
			() => refreshWithAccountRecovery(refreshCookie, () => credentials, passwordLogin),
		);
		const retried = await send(nextToken);

		expect(retried.status).toBe(200);
		expect(refreshCookie).toHaveBeenCalledTimes(1);
		expect(passwordLogin).toHaveBeenCalledWith(credentials);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("does not prompt a password login for transient refresh failures", async () => {
		const loadCredentials = vi.fn(() => ({ username: "user", password: "password" }));
		const login = vi.fn(async () => "fresh");
		await expect(
			refreshWithAccountRecovery(
				async () => {
					throw new Error("network timeout");
				},
				loadCredentials,
				login,
			),
		).rejects.toThrow("network timeout");
		expect(loadCredentials).not.toHaveBeenCalled();
		expect(login).not.toHaveBeenCalled();
	});

	it("coalesces concurrent unauthorized requests and reuses a token refreshed by another request", async () => {
		const coordinator = new AccessTokenRefreshCoordinator();
		let resolveRefresh: ((token: string) => void) | undefined;
		let markRefreshStarted: (() => void) | undefined;
		const refreshStarted = new Promise<void>((resolve) => {
			markRefreshStarted = resolve;
		});
		let currentToken: string | undefined = "expired";
		const refresh = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveRefresh = resolve;
					markRefreshStarted?.();
				}),
		);
		const clear = () => {
			currentToken = undefined;
		};
		const first = coordinator.afterUnauthorized("expired", () => currentToken, clear, refresh);
		const second = coordinator.afterUnauthorized("expired", () => currentToken, clear, refresh);
		await refreshStarted;
		resolveRefresh?.("fresh");
		expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
		expect(refresh).toHaveBeenCalledTimes(1);

		currentToken = "newer";
		await expect(coordinator.afterUnauthorized("expired", () => currentToken, clear, refresh)).resolves.toBe("newer");
	});
});
