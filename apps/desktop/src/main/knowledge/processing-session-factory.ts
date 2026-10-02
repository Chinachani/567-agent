import {
	createKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactory,
} from "@567agent/coding-agent/composition";
import { getAgentDir } from "@567agent/coding-agent/config";
import type { CodingAgentModelRuntime } from "@567agent/coding-agent/host-services";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "@567agent/coding-agent/model-context";
import {
	createDesktopCodingAgentSessionExecutionEnvironment,
	createDesktopCodingAgentToolEnvironment,
	createDesktopResultArtifactRuntime,
} from "@567agent/runtime-desktop";
import { nodeModelInputImageProcessor, nodeWorkspaceFactsFileSource } from "@567agent/runtime-node/coding";
import { createFileConversationPersistence } from "@567agent/runtime-node/conversation";
import { createNodeKnowledgeRuntime } from "@567agent/runtime-node/host";
import { getKnowledgeRoot } from "./knowledge-layout.js";

export interface DesktopKnowledgeProcessingSessionFactoryOptions {
	readonly getModelRegistry: () => CodingAgentModelRuntime;
}

/** Knowledge Processing 保留独立的场景装配边界，并复用宿主提供的模型与工具服务。 */
export function createDesktopKnowledgeProcessingSessionFactory(
	options: DesktopKnowledgeProcessingSessionFactoryOptions,
): KnowledgeProcessingSessionFactory {
	const resultArtifacts = createDesktopResultArtifactRuntime(getAgentDir());
	return createKnowledgeProcessingSessionFactory({
		getModelRegistry: options.getModelRegistry,
		createConversationPersistence: ({ conversationDir }) => createFileConversationPersistence(conversationDir),
		createToolEnvironment: createDesktopCodingAgentToolEnvironment,
		createSessionExecutionEnvironment: createDesktopCodingAgentSessionExecutionEnvironment,
		codingToolResultPolicy: resultArtifacts.codingToolResultPolicy,
		modelInputImageProcessor: nodeModelInputImageProcessor,
		knowledgeRuntime: createNodeKnowledgeRuntime(getKnowledgeRoot()),
		resolveWorkspaceFacts: (cwd) =>
			detectWorkspaceFacts(cwd, (root) => probeWorkspaceSignals(root, nodeWorkspaceFactsFileSource)),
	});
}
