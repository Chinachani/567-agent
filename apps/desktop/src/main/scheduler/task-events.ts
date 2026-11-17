import type { AutomationTaskEvent } from "../../shared/automation.js";
import { getAppLogger } from "../logger.js";

const handlers = new Set<(event: AutomationTaskEvent) => void>();
export function onTaskEvent(handler: (event: AutomationTaskEvent) => void): () => void {
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}
export function emitTaskEvent(event: AutomationTaskEvent): void {
	for (const handler of handlers) {
		try {
			handler(event);
		} catch (error) {
			getAppLogger("scheduler").warn("automation event delivery failed", error);
		}
	}
}
