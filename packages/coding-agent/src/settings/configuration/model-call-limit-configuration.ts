import type {
	RuntimeConfigurationDefinition,
	RuntimeConfigurationJsonObject,
} from "@567agent/runtime-core/configuration";

export const CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID = "coding.model-call-limit";

export interface CodingAgentModelCallLimitConfiguration extends RuntimeConfigurationJsonObject {
	readonly enabled: boolean;
	readonly maxCalls: number;
}

export const CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION = Object.freeze({
	id: CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID,
	schemaVersion: 1,
	descriptor: {
		title: "Model calls per run",
		description: "Limits model requests within one task, independently of token context capacity.",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["enabled", "maxCalls"],
			properties: {
				enabled: { type: "boolean" },
				maxCalls: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
			},
		},
		presentation: { group: "execution", order: ["enabled", "maxCalls"] },
	},
	codec: {
		decode(value: unknown): CodingAgentModelCallLimitConfiguration {
			if (typeof value !== "object" || value === null || Array.isArray(value))
				throw new TypeError("Invalid model-call limit configuration");
			const input = value as Record<string, unknown>;
			if (typeof input.enabled !== "boolean") throw new TypeError("Invalid model-call limit enabled flag");
			if (typeof input.maxCalls !== "number" || !Number.isSafeInteger(input.maxCalls) || input.maxCalls < 1)
				throw new RangeError("maxCalls must be a positive safe integer");
			return { enabled: input.enabled, maxCalls: input.maxCalls };
		},
	},
	defaultValue: { enabled: true, maxCalls: 100 },
	apply: "next-turn",
} satisfies RuntimeConfigurationDefinition<CodingAgentModelCallLimitConfiguration>);
