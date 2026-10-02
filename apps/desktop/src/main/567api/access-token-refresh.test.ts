import { describe, expect, it, vi } from "vitest";
import {
	AccessTokenRefreshCoordinator,
	RefreshCookieRejectedError,
	refreshWithAccountRecovery,
} from "./access-token-refresh.js";

describe("567 API account token recovery", () => {
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
