import type { AccountCredentials } from "./account-credentials.js";

export class AccessTokenRefreshCoordinator {
	private inFlight: Promise<string> | null = null;

	run(refresh: () => Promise<string>): Promise<string> {
		if (this.inFlight) return this.inFlight;
		const pending = Promise.resolve().then(refresh);
		this.inFlight = pending;
		void pending.then(
			() => this.clearIfCurrent(pending),
			() => this.clearIfCurrent(pending),
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

	private clearIfCurrent(pending: Promise<string>): void {
		if (this.inFlight === pending) this.inFlight = null;
	}
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
