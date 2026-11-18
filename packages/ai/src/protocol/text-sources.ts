/** Display-only source metadata supplied by a provider for a text block. */
export interface TextSource {
	readonly url: string;
	readonly title?: string;
}

/** Keep the first occurrence in place; a later annotation may supply a missing title. */
export function mergeTextSources(previous: readonly TextSource[], incoming: unknown): readonly TextSource[] {
	if (!Array.isArray(incoming) || incoming.length === 0) return previous;
	const sources = new Map(previous.map((entry) => [entry.url, entry]));
	let changed = false;
	for (const item of incoming.slice(0, 96)) {
		if (!item || typeof item !== "object" || typeof item.url !== "string") continue;
		const raw: string = item.url;
		if (
			raw.length > 2048 ||
			!/^https?:\/\/[^/?#]+/i.test(raw) ||
			/[\s\\]/u.test(raw) ||
			[...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
		)
			continue;
		if (raw.split("://")[1]?.split(/[/?#]/, 1)[0]?.includes("@")) continue;
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			continue;
		}
		if (!url || !url.hostname || url.username || url.password || url.href.length > 2048) continue;
		const old = sources.get(url.href);
		if (old?.title || (!old && sources.size >= 32)) continue;
		const title =
			typeof item.title === "string"
				? Array.from(item.title.slice(0, 240) as string)
						.filter((c) => {
							const n = c.charCodeAt(0);
							return (
								n >= 32 &&
								!(n >= 127 && n <= 159) &&
								!(n >= 0x202a && n <= 0x202e) &&
								!(n >= 0x2066 && n <= 0x2069)
							);
						})
						.join("")
						.trim()
				: "";
		if (old && !title) continue;
		sources.set(url.href, title ? { url: url.href, title } : { url: url.href });
		changed = true;
	}
	return changed ? [...sources.values()] : previous;
}

/** A reply may include tool blocks; only its annotated text blocks are evidence. */
export function collectTextSources(content: unknown, previous: readonly TextSource[] = []): readonly TextSource[] {
	if (!Array.isArray(content)) return previous;
	let sources = previous;
	for (const part of content) if (part?.type === "text") sources = mergeTextSources(sources, part.sources);
	return sources;
}
