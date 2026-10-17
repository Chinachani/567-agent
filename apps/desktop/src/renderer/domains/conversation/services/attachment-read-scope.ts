import type { MentionedFile } from "@shared/conversation";

/** Reading scope is an explicit user request; attachments retain their original bytes. */
export function appendAttachmentReadScopes(text: string, files: readonly MentionedFile[]): string {
	const scopes = files.flatMap((file) =>
		file.readScope?.trim() ? [`${file.name}: ${file.readScope.trim().slice(0, 300)}`] : [],
	);
	return scopes.length ? `${text}\n\n[Attachment reading scopes requested by user]\n${scopes.join("\n")}` : text;
}
