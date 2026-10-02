import { join } from "node:path";
import { createNodeLegacySessionHost } from "@567agent/runtime-node/host";

export function createCliHistoricalSessionHost(options: { readonly cwd: string; readonly agentDir: string }) {
	return createNodeLegacySessionHost({
		defaultCwd: options.cwd,
		sessionsDirectory: join(options.agentDir, "sessions"),
	});
}
