/** Only the conventional leading product title and its adjacent ISO date are metadata. */
export function parseReleaseNote(source: string, version?: string): { body: string; date?: string } {
	const lines = source.replace(/\r\n?/g, "\n").trim().split("\n");
	const title = /^#\s+(?:567 Agent\s+v?|v)(\d+\.\d+\.\d+)\s*$/i.exec(lines[0] ?? "");
	if (!title || (version && title[1] !== version.replace(/^v/, ""))) return { body: source };
	lines.shift();
	while (lines[0]?.trim() === "") lines.shift();
	const date = lines[0]?.trim();
	if (
		date &&
		/^\d{4}-\d{2}-\d{2}$/.test(date) &&
		!Number.isNaN(Date.parse(date)) &&
		new Date(date).toISOString().slice(0, 10) === date
	) {
		lines.shift();
		return { body: lines.join("\n").trim(), date };
	}
	return { body: lines.join("\n").trim() };
}
