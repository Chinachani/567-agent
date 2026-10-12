import type { Server } from "node:http";

export function startUpdateFeedFixture(
	versionOrOptions: string | {
		version: string;
		downloadable?: boolean;
		metadataDelayMs?: number;
	},
): Promise<{ server: Server; url: string }>;
