import { getExportTemplateDir } from "@567agent/coding-agent/config";
import { createCodingAgentHtmlExportRuntime } from "@567agent/coding-agent/export-html";
import { parseCodingAgentHistoricalSessionDocument } from "@567agent/coding-agent/historical-sessions";
import { createNodeHtmlExportFileAdapters, nodeSyncTextFileSource } from "@567agent/runtime-node/host";

export function createCliCodingAgentHtmlExportRuntime() {
	return createCodingAgentHtmlExportRuntime(
		createNodeHtmlExportFileAdapters({
			templateDirectory: getExportTemplateDir(),
			readLegacySession: (path) => parseCodingAgentHistoricalSessionDocument(nodeSyncTextFileSource.read(path)),
		}),
	);
}
