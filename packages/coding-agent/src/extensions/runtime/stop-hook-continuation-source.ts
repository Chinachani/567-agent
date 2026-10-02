import type { UserMessage } from "@567agent/ai";
import type { EcosystemHookRuntime } from "@567agent/ecosystem-adapter/hooks";
import type { ContinuationPolicyContext } from "@567agent/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";
import { getLastAssistantText } from "../../sessions/index.js";

export interface CodingAgentStopHookContinuationSourceOptions {
	readonly hookRuntime: Pick<EcosystemHookRuntime, "runStop">;
	readonly now?: () => number;
}

/** 把既有 Ecosystem Stop Hook 的文本片段适配为普通 continuation UserMessage。 */
export class CodingAgentStopHookContinuationSource implements CodingAgentContinuationSource {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentStopHookContinuationSourceOptions) {
		this.now = options.now ?? Date.now;
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		const fragments = await this.options.hookRuntime.runStop(
			getLastAssistantText([...context.messages]) ?? null,
			context.signal,
		);
		return fragments.map((text) => ({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: this.now(),
		}));
	}
}
