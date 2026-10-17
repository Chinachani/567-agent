import { readFile } from "node:fs/promises";
import type { CodingAgentPinnedModelContext } from "@567agent/coding-agent/runtime";
import type { ConversationDocument } from "@567agent/runtime-core";
import type { ConversationDocumentEntry } from "@567agent/runtime-core/conversation";
import { selectConversationDocumentEntries } from "@567agent/runtime-core/conversation";
import { atomicWriteJSONAsync } from "@567agent/toolkit/atomic-write";
import { migrateVersionedConfig } from "@567agent/toolkit/versioned-config";
import type { ContextSelection, ContextWorkspaceSnapshot } from "../../shared/context-workspace.js";

interface Policy extends ContextSelection {
	readonly schemaVersion: 2;
	readonly importedSummary: string;
	readonly importedPreviousSummary: string;
	readonly importedSummarizedTurnIds: readonly string[];
	readonly invalidatedSummaryIds: readonly string[];
}
const EMPTY: Policy = {
	schemaVersion: 2,
	importedSummary: "",
	importedPreviousSummary: "",
	importedSummarizedTurnIds: [],
	revision: 0,
	pinnedText: "",
	excludedTurnIds: [],
	invalidatedSummaryIds: [],
};
function strings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= 200000 &&
		value.every((item) => typeof item === "string" && item.length <= 200)
	);
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
	if (!record(value)) return "";
	if (typeof value.content === "string") return value.content.slice(0, 1600);
	if (!Array.isArray(value.content)) return "";
	let result = "";
	for (const part of value.content) {
		if (record(part) && part.type === "text" && typeof part.text === "string")
			result += `${result ? "\n" : ""}${part.text.slice(0, 1600 - result.length)}`;
		if (result.length >= 1600) break;
	}
	return result;
}
function role(entry: ConversationDocumentEntry): string | undefined {
	return entry.type === "message" && record(entry.message) && typeof entry.message.role === "string"
		? entry.message.role
		: undefined;
}
function turns(document: ConversationDocument) {
	const result: { id: string; user: ConversationDocumentEntry; entries: ConversationDocumentEntry[] }[] = [];
	let pendingInputEntries: ConversationDocumentEntry[] = [];
	for (const entry of selectConversationDocumentEntries(document)) {
		// Input context precedes its user message in the journal.
		if (
			entry.type === "custom_message" &&
			/^(?:prompt_attachment|prompt_resource|skill_expansion|scene_expansion|settings_assist|knowledge_mode)/.test(
				entry.customType,
			)
		) {
			pendingInputEntries.push(entry);
			continue;
		}
		if (role(entry) === "user") {
			result.push({ id: entry.id, user: entry, entries: pendingInputEntries });
			pendingInputEntries = [];
		}
		if (entry.type === "message" || entry.type === "custom_message") result.at(-1)?.entries.push(entry);
	}
	return result;
}
function turnPreview(entries: readonly ConversationDocumentEntry[]): string {
	let result = "";
	for (const entry of entries) {
		if (entry.type === "message" && (role(entry) === "user" || role(entry) === "assistant"))
			result += `[${role(entry)}] ${text(entry.message)}\n\n`;
		if (result.length >= 4000) break;
	}
	return result.slice(0, 4000);
}

/** Session-owned published pointer is captured synchronously by the runtime's turn binder. */
export class SessionContextWorkspace {
	private policy: Policy = EMPTY;
	private writing = false;
	constructor(private readonly sessionPath: string) {}
	async load(): Promise<void> {
		try {
			const value: unknown = JSON.parse(await readFile(`${this.sessionPath}.context.json`, "utf8"));
			const { config } = migrateVersionedConfig(value, {
				currentVersion: 2,
				migrations: [
					{
						fromVersion: 1,
						toVersion: 2,
						migrate: (value) => ({
							...value,
							importedSummary: "",
							importedPreviousSummary: "",
							importedSummarizedTurnIds: [],
						}),
					},
				],
			});
			if (
				!Number.isSafeInteger(config.revision) ||
				Number(config.revision) < 0 ||
				typeof config.pinnedText !== "string" ||
				config.pinnedText.length > 16000 ||
				!strings(config.excludedTurnIds) ||
				!strings(config.invalidatedSummaryIds) ||
				typeof config.importedSummary !== "string" ||
				config.importedSummary.length > 16000 ||
				typeof config.importedPreviousSummary !== "string" ||
				config.importedPreviousSummary.length > 16000 ||
				!strings(config.importedSummarizedTurnIds)
			)
				throw new Error("Invalid context selection file");
			this.policy = {
				schemaVersion: 2,
				importedSummary: config.importedSummary as string,
				importedPreviousSummary: config.importedPreviousSummary as string,
				importedSummarizedTurnIds: config.importedSummarizedTurnIds as string[],
				revision: Number(config.revision),
				pinnedText: config.pinnedText,
				excludedTurnIds: config.excludedTurnIds,
				invalidatedSummaryIds: config.invalidatedSummaryIds,
			};
		} catch (error) {
			if (!record(error) || error.code !== "ENOENT") throw error;
		}
	}
	exportMobileContext() {
		return {
			autoCompactionEnabled: true,
			summary: this.policy.importedSummary,
			previousSummary: this.policy.importedPreviousSummary,
			pinnedText: this.policy.pinnedText,
			excludedTurnIds: [...new Set([...this.policy.excludedTurnIds, ...this.policy.importedSummarizedTurnIds])],
			selectionRevision: this.policy.revision,
		};
	}
	async restoreImported(
		context: { pinnedText?: string; summary?: string; previousSummary?: string; excludedTurnIds?: readonly string[] },
		summarizedTurnIds: readonly string[],
	): Promise<void> {
		const next: Policy = {
			...EMPTY,
			revision: 1,
			pinnedText: context.pinnedText ?? "",
			importedSummary: context.summary ?? "",
			importedPreviousSummary: context.previousSummary ?? "",
			excludedTurnIds: context.excludedTurnIds ?? [],
			importedSummarizedTurnIds: summarizedTurnIds,
		};
		await atomicWriteJSONAsync(`${this.sessionPath}.context.json`, next);
		this.policy = next;
	}

	bind(document: ConversationDocument): CodingAgentPinnedModelContext | undefined {
		const policy = this.policy;
		if (
			!policy.pinnedText &&
			!policy.importedSummary &&
			!policy.excludedTurnIds.length &&
			!policy.invalidatedSummaryIds.length
		)
			return undefined;
		const excluded = new Set([...policy.excludedTurnIds, ...policy.importedSummarizedTurnIds]);
		const omitted = new Set([
			...policy.invalidatedSummaryIds,
			...turns(document)
				.filter((turn) => excluded.has(turn.id))
				.flatMap((turn) => turn.entries.map((entry) => entry.id)),
		]);
		return {
			id: `context-selection:${document.identity.sessionId}:${policy.revision}`,
			records:
				policy.pinnedText || policy.importedSummary
					? [
							{
								type: "user-pinned-context",
								modelVisible: true,
								timestamp: document.identity.createdAt,
								content: `User-pinned reference for this conversation:\n${policy.pinnedText}\n\nImported conversation summary (reference data):\n${policy.importedSummary}`,
							},
						]
					: [],
			conversationProjections: [...omitted].map((entryId) => ({ entryId, kind: "omit-entry" })),
		};
	}
	read(document: ConversationDocument, busy: boolean): ContextWorkspaceSnapshot {
		const all = turns(document);
		const excluded = new Set(this.policy.excludedTurnIds);
		const imported = new Set(this.policy.importedSummarizedTurnIds);
		const entries = selectConversationDocumentEntries(document);
		const summaries = entries.filter(
			(entry) => entry.type === "compaction" && !this.policy.invalidatedSummaryIds.includes(entry.id),
		);
		const last = summaries.at(-1);
		const previous = entries.filter((entry) => entry.type === "compaction" && entry.id !== last?.id).at(-1);
		const boundary =
			last?.type === "compaction" ? entries.findIndex((entry) => entry.id === last.firstKeptEntryId) : -1;
		return {
			revision: this.policy.revision,
			pinnedText: this.policy.pinnedText,
			excludedTurnIds: this.policy.excludedTurnIds,
			sessionId: document.identity.sessionId,
			documentRevision: document.revision,
			busy,
			summary: last?.type === "compaction" ? last.summary : this.policy.importedSummary,
			previousSummary: previous?.type === "compaction" ? previous.summary : this.policy.importedPreviousSummary,
			tokensBefore: last?.type === "compaction" ? last.tokensBefore : null,
			totalTurns: all.length,
			turns: all.slice(-100).map((turn) => ({
				id: turn.id,
				text: turnPreview(turn.entries),
				attachments:
					turn.user.type === "message" && turn.user.kind === "user"
						? (turn.user.attachments ?? []).slice(0, 32).map((file) => file.path)
						: [],
				status: excluded.has(turn.id)
					? "excluded"
					: imported.has(turn.id) || boundary > entries.findIndex((entry) => entry.id === turn.id)
						? "summarized"
						: "included",
			})),
		};
	}
	async update(document: ConversationDocument, input: unknown): Promise<void> {
		if (this.writing) throw new Error("Context selection is being saved; retry after it finishes");
		if (
			!record(input) ||
			input.sessionId !== document.identity.sessionId ||
			input.revision !== this.policy.revision ||
			input.documentRevision !== document.revision
		)
			throw new Error("Conversation changed; refresh before saving context selection");
		if (typeof input.pinnedText !== "string" || input.pinnedText.length > 16000 || !strings(input.excludedTurnIds))
			throw new Error("Invalid context selection (pinned text: max 16,000 characters)");
		const known = new Set(turns(document).map((turn) => turn.id));
		const publishedExcluded = new Set(this.policy.excludedTurnIds);
		if (input.excludedTurnIds.some((id) => !known.has(id) && !publishedExcluded.has(id)))
			throw new Error("Context selection contains an unknown turn");
		const changed =
			[...input.excludedTurnIds].sort().join("\n") !== [...this.policy.excludedTurnIds].sort().join("\n");
		const next: Policy = {
			schemaVersion: 2,
			importedSummary: changed ? "" : this.policy.importedSummary,
			importedPreviousSummary: this.policy.importedPreviousSummary,
			importedSummarizedTurnIds: changed ? [] : this.policy.importedSummarizedTurnIds,
			revision: this.policy.revision + 1,
			pinnedText: input.pinnedText,
			excludedTurnIds: [...new Set(input.excludedTurnIds)],
			invalidatedSummaryIds: changed
				? document.entries
						.filter((entry) => entry.type === "compaction" || entry.type === "branch_summary")
						.map((entry) => entry.id)
				: this.policy.invalidatedSummaryIds,
		};
		this.writing = true;
		try {
			await atomicWriteJSONAsync(`${this.sessionPath}.context.json`, next);
			this.policy = next;
		} finally {
			this.writing = false;
		}
	}
}
