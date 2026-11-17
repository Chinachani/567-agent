import type { AgentBlueprint, AgentTeamDocument } from "@567agent/agent-team";
import { useLocalizedAgentTeamDocument } from "@shared/agent-teams/agent-team-localization";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { BlueprintDisplayPlugin } from "../lib/blueprint-display";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";

/**
 * Agent 与 Team 共用同一份 `AgentTeamDocument`，所以文档、蓝图和能力目录集中在
 * 这里加载，再由各职责 model 消费，避免两套状态各自请求后互相覆盖。
 */
export interface AgentTeamResources {
	/** 已按界面语言解析插件名称的展示文档；`setDocument` 的函数式更新拿到的仍是原始文档。 */
	readonly document?: AgentTeamDocument;
	readonly setDocument: Dispatch<SetStateAction<AgentTeamDocument | undefined>>;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly plugins: readonly BlueprintDisplayPlugin[];
	readonly loading: boolean;
	readonly error?: string;
	readonly setError: (error: string | undefined) => void;
	readonly reload: () => Promise<void>;
}

export function useAgentTeamResources(): AgentTeamResources {
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	const [plugins, setPlugins] = useState<readonly BlueprintDisplayPlugin[]>([]);
	const [capabilities, setCapabilities] = useState<readonly AgentCapabilityOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const mounted = useRef(false);
	const generation = useRef(0);
	const reload = useCallback(async () => {
		const request = ++generation.current;
		try {
			const resources = await loadAgentTeamConfigurationResources();
			if (!mounted.current || request !== generation.current) return;
			setDocument(resources.document);
			setBlueprints(resources.blueprints);
			setPlugins(resources.plugins);
			setCapabilities(resources.capabilities);
			setError(undefined);
		} catch (cause) {
			if (mounted.current && request === generation.current) setError(agentTeamErrorMessage(cause));
		} finally {
			if (mounted.current && request === generation.current) setLoading(false);
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		const unsubscribe = window.agent567.agentTeams.onChanged(() => {
			void reload();
		});
		void reload();
		return () => {
			mounted.current = false;
			++generation.current;
			unsubscribe();
		};
	}, [reload]);

	const displayDocument = useLocalizedAgentTeamDocument(document);

	return {
		document: displayDocument,
		setDocument,
		blueprints,
		plugins,
		capabilities,
		loading,
		error,
		setError,
		reload,
	};
}

export function agentTeamErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
