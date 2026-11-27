import type { AIError } from "../protocol/index.js";
import type { Api, AssistantMessage, Context, Message, Model, ThinkingContent } from "../types.js";
import { isBedrockClaudeModel } from "./amazon-bedrock/options.js";
import { isValidThoughtSignature } from "./google-stream/thought-signature.js";

type SignatureKind = "anthropic" | "bedrock" | "gemini" | "responses";

const rejectedGeminiSignature = [
	/\b(?:invalid|expired|corrupt(?:ed)?|malformed) (?:the )?thought[ _]?signature\b/u,
	/\bthought[ _]?signature (?:is|was|has been) (?:invalid|not valid|expired|corrupt(?:ed)?|malformed)\b/u,
	/\b(?:unable|failed) to (?:validate|verify|decode) (?:the )?thought[ _]?signature\b/u,
	/\bthought[ _]?signature (?:could not|cannot) be (?:validated|verified|decoded)\b/u,
	/\binvalid value at ['"]?contents\[\d+\]\.parts\[\d+\]\.thought_?signature\b/u,
];

export function isSameModel(message: AssistantMessage, model: Model<Api>): boolean {
	return message.api === model.api && message.provider === model.provider && message.model === model.id;
}

export function projectSignedReasoningHistory(context: Context, model: Model<Api>): Context {
	const kind = signatureKind(model);
	if (!kind) return context;
	for (let index = context.messages.length - 1; index > 0; index--) {
		const message = context.messages[index];
		if (isReplayableAssistant(message, model) && message.signedReasoningReset === true) {
			return omitSignedReasoning(context, model, kind, index);
		}
	}
	return context;
}

export function repairSignedReasoningHistory(context: Context, model: Model<Api>, failure: AIError): Context {
	const kind = signatureKind(model);
	if (!kind || !isSignatureRejection(kind, failure)) return context;
	return omitSignedReasoning(context, model, kind, context.messages.length);
}

function signatureKind(model: Model<Api>): SignatureKind | undefined {
	switch (model.api) {
		case "anthropic-messages":
			return "anthropic";
		case "bedrock-converse-stream":
			return isBedrockClaudeModel(model.id) ? "bedrock" : undefined;
		case "google-generative-ai":
		case "google-gemini-cli":
		case "google-vertex":
			return "gemini";
		case "openai-responses":
		case "azure-openai-responses":
		case "openai-codex-responses":
			return "responses";
	}
}

function isSignatureRejection(kind: SignatureKind, failure: AIError): boolean {
	const message = failure.message.toLowerCase().replaceAll("`", "");
	if (kind === "responses") {
		if (failure.providerCode === "invalid_encrypted_content") {
			return failure.statusCode === 400 || (failure.statusCode === undefined && failure.phase === "stream");
		}
		return (
			failure.statusCode === 400 &&
			/\bencrypted[ _]content\b/u.test(message) &&
			/\b(?:could not be verified|has expired)\b/u.test(message)
		);
	}
	if (failure.statusCode !== 400) return false;
	if (kind === "gemini") return rejectedGeminiSignature.some((pattern) => pattern.test(message));
	if (kind === "bedrock" && failure.providerCode !== "ValidationException") return false;
	return (
		/\binvalid signature in (?:the )?thinking block\b|\bsignature in (?:the )?thinking block is invalid\b/u.test(
			message,
		) ||
		((/\b(?:thinking blocks?|redacted_thinking)\b/u.test(message) ||
			failure.message.toLowerCase().includes("`thinking`")) &&
			/\b(?:invalid signature|cannot be modified|bound to a different conversation|not created in this conversation)\b/u.test(
				message,
			))
	);
}

function isReplayableAssistant(message: Message, model: Model<Api>): message is AssistantMessage {
	return (
		message.role === "assistant" &&
		message.stopReason !== "error" &&
		message.stopReason !== "aborted" &&
		isSameModel(message, model)
	);
}

function omitSignedReasoning(context: Context, model: Model<Api>, kind: SignatureKind, before: number): Context {
	let messages: Message[] | undefined;
	for (let index = 0; index < before; index++) {
		const message = context.messages[index];
		if (!isReplayableAssistant(message, model)) continue;
		const content =
			kind === "gemini" ? omitGeminiSignatures(message.content) : omitThinkingBlocks(message.content, kind);
		if (!content) continue;
		// Claude converters skip empty assistant messages, which would alter the conversation prefix.
		if (
			(kind === "anthropic" || kind === "bedrock") &&
			!content.some(
				(block) => block.type === "toolCall" || (block.type === "text" ? block.text : block.thinking).trim(),
			)
		) {
			content.push({ type: "text", text: "[Thinking removed]" });
		}
		messages ??= context.messages.slice();
		messages[index] = { ...message, content };
	}
	return messages ? { ...context, messages } : context;
}

function omitThinkingBlocks(content: AssistantMessage["content"], kind: Exclude<SignatureKind, "gemini">) {
	const filtered = content.filter((block) => block.type !== "thinking" || !isSignedReasoning(block, kind));
	return filtered.length !== content.length ? filtered : undefined;
}

function omitGeminiSignatures(content: AssistantMessage["content"]): AssistantMessage["content"] | undefined {
	let changed = false;
	const repaired = content.flatMap((block): AssistantMessage["content"] => {
		if (block.type === "thinking" && block.thinking.trim() && isValidThoughtSignature(block.thinkingSignature)) {
			changed = true;
			return [];
		}
		if (block.type === "text" && block.text.trim() && isValidThoughtSignature(block.textSignature)) {
			changed = true;
			const { textSignature: _signature, ...text } = block;
			return [text];
		}
		if (block.type === "toolCall" && isValidThoughtSignature(block.thoughtSignature)) {
			changed = true;
			const { thoughtSignature: _signature, ...call } = block;
			return [call];
		}
		return [block];
	});
	return changed ? repaired : undefined;
}

function isSignedReasoning(block: ThinkingContent, kind: Exclude<SignatureKind, "gemini">): boolean {
	const signature = block.thinkingSignature;
	if (!signature?.trim()) return false;
	if (kind !== "responses") return block.thinking.trim().length > 0;
	try {
		const item: unknown = JSON.parse(signature);
		return (
			typeof item === "object" &&
			item !== null &&
			"type" in item &&
			item.type === "reasoning" &&
			"encrypted_content" in item &&
			typeof item.encrypted_content === "string" &&
			item.encrypted_content.length > 0
		);
	} catch {
		return false;
	}
}
