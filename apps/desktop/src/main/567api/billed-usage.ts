import type { Api567BilledSnapshot } from "../../shared/local-usage-log.js";

interface BillResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	data: { success?: boolean; data?: { quota?: number } };
}

export function retryAfter(value: string | string[] | undefined, now: number): number {
	const header = (Array.isArray(value) ? value[0] : value)?.trim();
	if (!header) return 0;
	const time = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
	return Number.isFinite(time) ? time : 0;
}

export class BilledUsageReader {
	private snapshot?: Api567BilledSnapshot;
	private inFlight?: Promise<Api567BilledSnapshot>;
	private day = 0;
	private failures = 0;
	private nextRequest = 0;

	async read(
		load: (from: number, to: number) => Promise<BillResponse>,
		cooldown: number,
	): Promise<Api567BilledSnapshot> {
		const now = Date.now();
		const day = new Date(now).setHours(0, 0, 0, 0);
		if (this.inFlight) {
			if (this.day === day) return this.inFlight;
			await this.inFlight;
			return this.read(load, cooldown);
		}
		if (day !== this.day) {
			this.snapshot = undefined;
			this.day = day;
		}
		const retryAt = Math.max(cooldown, this.nextRequest);
		if (now < retryAt) return { ...(this.snapshot ?? { status: "unavailable" }), retryAt };
		this.inFlight = (async (): Promise<Api567BilledSnapshot> => {
			try {
				const result = await load(Math.floor(day / 1000), Math.floor(now / 1000));
				const quota = result.data?.data?.quota;
				if (
					result.status === 200 &&
					result.data?.success === true &&
					typeof quota === "number" &&
					Number.isSafeInteger(quota) &&
					quota >= 0
				) {
					this.failures = 0;
					this.nextRequest = Math.min(Date.now() + 5 * 60_000, new Date(day).setHours(24, 0, 0, 0));
					this.snapshot = { status: "ready", checkedAt: now, quota, retryAt: this.nextRequest };
					return this.snapshot;
				}
				this.nextRequest = retryAfter(result.headers["retry-after"], Date.now());
				if (result.status === 401 || result.status === 403) {
					this.nextRequest = Math.max(this.nextRequest, Date.now() + 5 * 60_000);
					this.snapshot = { status: "restricted", retryAt: this.nextRequest };
					return this.snapshot;
				}
				if (result.status === 429) this.nextRequest = Math.max(this.nextRequest, Date.now() + 2 * 60_000);
			} catch {
				// A transient failure can still use today's last confirmed reading.
			}
			this.nextRequest = Math.max(this.nextRequest, Date.now() + 30_000 * 2 ** Math.min(this.failures++, 5));
			this.snapshot = {
				...this.snapshot,
				status: this.snapshot?.quota == null ? "unavailable" : "stale",
				retryAt: this.nextRequest,
			};
			return this.snapshot;
		})();
		try {
			return await this.inFlight;
		} finally {
			this.inFlight = undefined;
		}
	}
}
