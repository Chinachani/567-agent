// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import i18n from "i18next";
import { initI18n } from "@shared/i18n";
import { AttachmentThumbnail } from "./AttachmentThumbnail";
let reveal: () => void;
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
				reveal = () => callback([{ isIntersecting: true }]);
			}
			observe() {}
			disconnect() {}
		},
	);
});
afterEach(cleanup);
it("loads only after a row is visible and displays the preview without opening its original", async () => {
	const read = vi.fn(async () => ({ url: "data:image/png;base64,aGVsbG8=", unavailable: false }));
	render(<AttachmentThumbnail id="image" read={read} />);
	expect(read).not.toHaveBeenCalled();
	act(() => reveal());
	expect(await screen.findByRole("img", { name: "图片缩略图" })).toBeTruthy();
	await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,aGVsbG8="));
});
it("does not render remote URLs or executable data as image previews", async () => {
	const read = vi.fn(async () => ({ url: "data:image/svg+xml,<svg/>", unavailable: true }));
	render(<AttachmentThumbnail id="missing" read={read} />);
	act(() => reveal());
	expect(await screen.findByRole("img", { name: /缩略图不可用/ })).toBeTruthy();
	expect(document.querySelector("img")).toBeNull();
});
