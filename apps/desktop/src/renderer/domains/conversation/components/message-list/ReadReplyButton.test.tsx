// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "zh-CN" },
	}),
}));

import { ReadReplyButton } from "./ReadReplyButton";

describe("ReadReplyButton", () => {
	const originalPlatform = navigator.platform;

	beforeEach(() => {
		Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
		Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
	});

	afterEach(() => {
		cleanup();
		Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
	});

	it.each([
		["Linux x86_64", "messageList.readReply.installHint.linux"],
		["Win32", "messageList.readReply.installHint.windows"],
		["MacIntel", "messageList.readReply.installHint.mac"],
	] as const)("shows the platform-specific offline voice installation hint on %s", (platform, hint) => {
		Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
		render(<ReadReplyButton text="测试回复" />);

		fireEvent.click(screen.getByRole("button"));

		expect(screen.getByRole("status").textContent).toContain(hint);
	});
});
