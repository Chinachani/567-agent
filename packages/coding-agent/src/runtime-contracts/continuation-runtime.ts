import type { UserMessage } from "@567agent/ai";
import type { ContinuationPolicyContext } from "@567agent/runtime-core/kernel";

export interface CodingAgentContinuationSource {
	collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]>;
}
