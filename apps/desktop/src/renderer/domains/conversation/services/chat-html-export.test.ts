// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatHtmlDocument } from "./chat-html-export";

describe("chat HTML export", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the current app brand when a user exports a conversation", async () => {
		initI18n();
		await i18n.changeLanguage("en");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false })),
		);
		const conversation = document.createElement("main");
		conversation.textContent = "A saved conversation";

		const html = await buildChatHtmlDocument(conversation, "My session");
		const exported = new DOMParser().parseFromString(html, "text/html");

		expect(exported.title).toBe("My session");
		expect(exported.querySelector("[data-share-nav] .vetta-share-nav__brand")?.textContent).toBe("567 Agent");
		expect(exported.querySelector("main")?.textContent).toBe("A saved conversation");
	});
});
