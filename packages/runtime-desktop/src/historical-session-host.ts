import { join } from "node:path";
import { getAgentDir } from "@567agent/coding-agent/config";
import { createNodeLegacySessionHost } from "@567agent/runtime-node/host";

export function createDesktopHistoricalSessionHost(defaultCwd = process.cwd()) {
	return createNodeLegacySessionHost({
		defaultCwd,
		sessionsDirectory: join(getAgentDir(), "sessions"),
	});
}
