import type { AIErrorDetails } from "./errors.js";
import type { StopReason } from "./finish-reason.js";
import type { Api, Provider } from "./identity.js";
import type { TextSource } from "./text-sources.js";
import type { ToolCall } from "./tool.js";
import type { Usage } from "./usage.js";

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
	sources?: TextSource[];
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: Provider;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	/** Older signed reasoning from this model was omitted when this reply was generated. */
	signedReasoningReset?: true;
	errorMessage?: string;
	/** Safe provider diagnostics retained when a terminal error is projected to a message. */
	failure?: AIErrorDetails;
	timestamp: number;
}

export interface ToolResultMessage<TDetails = unknown> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
