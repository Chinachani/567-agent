import type { AccountCredentials } from "./account-credentials.js";

export class AccessTokenRefreshCoordinator {
	private inFlight: Promise<string> | null = null;
	private failure: { error: unknown; retryAt: number; attempts: number } | null = null;

	constructor(private readonly now: () => number = () => Date.now()) {}

	run(refresh: () => Promise<string>): Promise<string> {
		if (this.inFlight) return this.inFlight;
		if (this.failure && this.now() < this.failure.retryAt) return Promise.reject(this.failure.error);
		const pending = Promise.resolve().then(refresh);
		this.inFlight = pending;
		void pending.then(
			() => {
				if (this.inFlight !== pending) return;
				this.failure = null;
				this.inFlight = null;
			},
			(error: unknown) => {
				if (this.inFlight !== pending) return;
				const attempts = (this.failure?.attempts ?? 0) + 1;
				const rejectedLogin = error instanceof AccountLoginRejectedError;
				const initialDelay = rejectedLogin ? 5 * 60_000 : 30_000;
				const maximumDelay = rejectedLogin ? 30 * 60_000 : 5 * 60_000;
				const delay = Math.min(maximumDelay, initialDelay * 2 ** Math.min(attempts - 1, 6));
				this.failure = { error, retryAt: this.now() + delay, attempts };
				this.inFlight = null;
			},
		);
		return pending;
	}

	afterUnauthorized(
		failedToken: string,
		getCurrentToken: () => string | undefined,
		clearCurrentToken: () => void,
		refresh: () => Promise<string>,
	): Promise<string> {
		const currentToken = getCurrentToken();
		if (currentToken && currentToken !== failedToken) return Promise.resolve(currentToken);
		if (currentToken === failedToken) clearCurrentToken();
		return this.run(refresh);
	}

	reset(): void {
		this.failure = null;
		this.inFlight = null;
	}
}

export class AccountLoginRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccountLoginRejectedError";
	}
}

export function isRefreshCookieRejected(response: { status: number; code?: unknown; message?: string }): boolean {
	if (response.status >= 500 || response.status === 429) return false;
	const code = Number(response.code);
	if (response.status === 401 || response.status === 403 || code === 401 || code === 403) return true;
	const message = response.message ?? "";
	return /unauthori[sz]ed|not logged in|未登[录陆]|(?:cookie|session|token|登[录陆](?:状态|信息|会话)?|会话|令牌)\s*(?:已(?:经)?|is\s+|has\s+|was\s+)?(?:过期|失效|无效|expired|invalid|rejected)|(?:expired|invalid|rejected)\s+(?:(?:refresh|access)\s+)?(?:cookie|session|token)|(?:过期|失效|无效)的?(?:cookie|session|token|会话|令牌)/i.test(
		message,
	);
}

export class RefreshCookieRejectedError extends Error {
	constructor(
		message: string,
		readonly status: 401 | 403,
	) {
		super(message);
		this.name = "RefreshCookieRejectedError";
	}
}

export async function refreshWithAccountRecovery(
	refresh: () => Promise<string>,
	loadCredentials: () => AccountCredentials | undefined,
	login: (credentials: AccountCredentials) => Promise<string>,
): Promise<string> {
	try {
		return await refresh();
	} catch (error) {
		if (!(error instanceof RefreshCookieRejectedError)) throw error;
		const credentials = loadCredentials();
		if (!credentials) throw error;
		return login(credentials);
	}
}
