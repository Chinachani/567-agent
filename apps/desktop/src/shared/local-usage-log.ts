export interface LocalUsageRow {
	id: string;
	sessionId: string;
	sessionName: string;
	provider: string;
	model: string;
	group?: string;
	timestamp: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	total?: number;
	durationMs?: number;
	firstTextMs?: number;
	status: "success" | "error" | "aborted";
}

export interface LocalUsageSnapshot {
	rows: LocalUsageRow[];
	partial: boolean;
}

export interface Api567BilledSnapshot {
	status: "ready" | "stale" | "unavailable" | "signed-out" | "restricted";
	checkedAt?: number;
	quota?: number;
	usd?: number;
	retryAt?: number;
}
