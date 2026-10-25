import { expect, it } from "vitest";
import { buildRemoteHistoryPage } from "./history-page.js";

it("loads all long-history pages without skipping rows, and marks a single oversized message", () => {
	const history = Array.from({ length: 12 }, (_, index) => ({
		id: String(index),
		role: "assistant" as const,
		text: index === 5 ? '长🦊\n"'.repeat(200_000) : "内容\n".repeat(35_000),
		timestamp: index,
	}));
	let offset = 0;
	const loaded = [];
	for (let pageCount = 0; pageCount < 20; pageCount++) {
		const page = buildRemoteHistoryPage(history.slice(offset, offset + 5), offset, 5, true);
		expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(900_000);
		loaded.push(...page.messages);
		if (!page.hasMore) break;
		expect(page.nextOffset).toBeGreaterThan(offset);
		offset = page.nextOffset;
	}
	expect(loaded.map((message) => message.id)).toEqual(history.map((message) => message.id));
	expect(loaded.filter((message) => message.truncated).map((message) => message.id)).toEqual(["5"]);
	expect(loaded[5].text.at(-1)).not.toMatch(/[\uD800-\uDBFF]/);
});

it("keeps the requested row count for legacy phones while bounding escaped UTF-8", () => {
	const input = Array.from({ length: 40 }, (_, index) => ({
		id: String(index),
		role: "user" as const,
		text: '长\n"'.repeat(30_000),
		timestamp: index,
	}));
	const page = buildRemoteHistoryPage(input, 40, 40, false);
	expect(page.messages).toHaveLength(40);
	expect(page.nextOffset).toBe(80);
	expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(900_000);
	expect(input[0].text.length).toBe(90_000);
});
