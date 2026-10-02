import type { AgentMessage } from "@567agent/agent-core";
import type { Api, Model } from "@567agent/ai";

export interface MemoryFactExtractionInput {
	readonly currentEntries: readonly string[];
	readonly messages: readonly AgentMessage[];
	readonly model: Model<Api>;
	readonly apiKey: string;
	readonly signal: AbortSignal;
}

export interface MemoryFactExtractor {
	extract(input: MemoryFactExtractionInput): Promise<readonly string[]>;
}
