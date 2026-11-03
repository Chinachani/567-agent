import type { WebContents } from "electron";
import type { OpenMarketplaceDiscoverySearch } from "../../../preload/api-types/abilities.js";
import type { McpDiscoveryQuery } from "../../../shared/mcp-discovery.js";

type Search = (
	requestId: string,
	sourceId: string,
	query: McpDiscoveryQuery,
	signal: AbortSignal,
	update: (result: OpenMarketplaceDiscoverySearch) => void,
) => Promise<OpenMarketplaceDiscoverySearch>;

/** Only the latest query per source owns progress; navigation and teardown release every download. */
export class DiscoverySearchHost {
	private readonly jobs = new Map<string, { id: string; controller: AbortController }>();
	constructor(
		private readonly owner: WebContents,
		private readonly search: Search,
	) {
		owner.on("destroyed", this.cancelAll);
		owner.on("render-process-gone", this.cancelAll);
		owner.on("did-start-navigation", this.onNavigation);
	}
	private onNavigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean): void => {
		if (mainFrame && !inPlace) this.cancelAll();
	};
	private cancelAll = (): void => {
		for (const job of this.jobs.values()) job.controller.abort();
		this.jobs.clear();
	};
	cancel(id: string): void {
		for (const [source, job] of this.jobs)
			if (job.id === id) {
				job.controller.abort();
				this.jobs.delete(source);
			}
	}
	async run(id: string, source: string, query: McpDiscoveryQuery): Promise<OpenMarketplaceDiscoverySearch> {
		if (this.owner.isDestroyed()) throw new Error("Discovery owner is unavailable");
		if (this.jobs.size >= 4 && !this.jobs.has(source)) throw new Error("Too many discovery queries");
		this.jobs.get(source)?.controller.abort();
		const job = { id, controller: new AbortController() };
		this.jobs.set(source, job);
		try {
			const result = await this.search(id, source, query, job.controller.signal, (result) => {
				if (this.jobs.get(source) === job && !job.controller.signal.aborted && !this.owner.isDestroyed())
					this.owner.send("vetta:abilities:discovery-search-updated", result);
			});
			job.controller.signal.throwIfAborted();
			return result;
		} finally {
			if (this.jobs.get(source) === job) this.jobs.delete(source);
		}
	}
	dispose(): void {
		this.cancelAll();
		this.owner.removeListener("destroyed", this.cancelAll);
		this.owner.removeListener("render-process-gone", this.cancelAll);
		this.owner.removeListener("did-start-navigation", this.onNavigation);
	}
}
