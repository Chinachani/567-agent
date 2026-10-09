import type { TSchema } from "@sinclair/typebox";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
	/** Historical output retained when importing tool activity from another client. */
	result?: string;
	/** Historical error status retained when importing tool activity from another client. */
	isError?: boolean;
	/** Historical elapsed time retained when importing tool activity from another client. */
	durationMs?: number;
}

export interface Tool<TParameters extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: TParameters;
}
