import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialDownloadsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["downloads"] {
	const downloads = window.agent567.plugins.internalCapabilities.downloads;
	return {
		list: async () => {
			assertOfficial();
			return downloads.list(capabilitySessionId);
		},
		cancel: async (id) => {
			assertOfficial();
			await downloads.cancel(capabilitySessionId, id);
		},
	};
}
