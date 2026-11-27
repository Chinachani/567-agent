import type { WebContents } from "electron";
import { SESSION_SEARCH_CHANNELS } from "../../shared/session-search.js";
import { onConversationListChanged } from "./conversation-list-events.js";
import { getDesktopConversationService } from "./desktop-conversation-service.js";
import { resolveDesktopRuntimeSessionRoots } from "./session-catalog-roots.js";
import { SessionSearchController } from "./session-search-controller.js";
import { listDesktopSessionSearchSources } from "./session-search-sources.js";
import { SessionSearchWorkerClient } from "./session-search-worker-client.js";

const worker = new SessionSearchWorkerClient();
onConversationListChanged(() => worker.invalidate());

export const desktopSessionSearch = new SessionSearchController({
	send: (owner, event) => (owner as WebContents).send(SESSION_SEARCH_CHANNELS.event, event),
	run: async (requestId, request, emit, signal) => {
		const sources = await listDesktopSessionSearchSources();
		signal.throwIfAborted();
		emit({ requestId, sources: sources.map(({ cwd, kind, name }) => ({ cwd, kind, name })), done: !request.query });
		if (!request.query) return;
		await new Promise<void>((done, reject) => {
			let chain = Promise.resolve();
			const cancel = worker.start(
				{ type: "start", requestId, request, sources, roots: resolveDesktopRuntimeSessionRoots() },
				(event) => {
					// Access checks are owned by the live Runtime, and must finish before the terminal event.
					chain = chain
						.then(async () => {
							if (signal.aborted) return;
							// 一批结果的权限检查互不依赖，并行做；保持原有顺序。
							const checked = await Promise.all(
								(event.results ?? []).map(async (result) => {
									const access = await getDesktopConversationService().resolveSessionAccess(
										result.session.path,
										result.session.cwd,
									);
									return access?.readHistory
										? { ...result, session: { ...result.session, access } }
										: undefined;
								}),
							);
							const results = checked.filter((result) => result !== undefined);
							if (!signal.aborted) emit({ ...event, results });
							if (event.done) {
								signal.removeEventListener("abort", abort);
								done();
							}
						})
						.catch((error: unknown) => {
							cancel();
							signal.removeEventListener("abort", abort);
							reject(error);
						});
				},
			);
			const abort = () => {
				cancel();
				done();
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	},
});
