import { type ComponentType, lazy } from "react";

export class RoutePageLoadError extends Error {
	constructor(
		readonly page: string,
		cause: unknown,
	) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "RoutePageLoadError";
	}
}

/** A rejected React.lazy component stays rejected until its document is replaced. */
export function lazyRoutePage(page: string, load: () => Promise<{ default: ComponentType }>) {
	return lazy(async () => {
		try {
			return await load();
		} catch (cause) {
			throw new RoutePageLoadError(page, cause);
		}
	});
}
