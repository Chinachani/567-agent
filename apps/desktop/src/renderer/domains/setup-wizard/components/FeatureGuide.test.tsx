/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { afterEach, beforeAll, expect, it } from "vitest";
import { FeatureGuide, FeatureGuideContent } from "./FeatureGuide";
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
afterEach(cleanup);

it("shows a compact directory, reads one topic and returns keyboard focus before closing", async () => {
	const user = userEvent.setup();
	render(<FeatureGuide />);
	const trigger = screen.getByRole("button", { name: "打开使用指南" });
	await user.click(trigger);
	const dialog = screen.getByRole("dialog", { name: "使用指南" });
	expect(within(dialog).getByRole("button", { name: "完成第一个任务" })).toBeTruthy();
	expect(within(dialog).queryByText(/在电脑确认屏幕共享/)).toBeNull();
	await user.click(within(dialog).getByRole("button", { name: "手机协作与远程控制" }));
	const article = within(dialog).getByRole("heading", { name: "手机协作与远程控制" });
	expect(document.activeElement).toBe(article);
	expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
	expect(within(dialog).queryByText(/先在模型配置中登录/)).toBeNull();
	await user.click(within(dialog).getByRole("button", { name: "返回目录" }));
	expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "手机协作与远程控制" }));
	await user.click(within(dialog).getByRole("button", { name: "完成第一个任务" }));
	expect(within(dialog).getByText(/先在模型配置中登录/)).toBeTruthy();
	await user.keyboard("{Escape}");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	await user.click(trigger);
	expect(screen.getByRole("button", { name: "完成第一个任务" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "返回目录" })).toBeNull();
});

it("supports the same directory when embedded in the welcome step without stealing focus", async () => {
	const user = userEvent.setup();
	render(
		<>
			<button type="button">Existing focus</button>
			<FeatureGuideContent />
		</>,
	);
	const previous = screen.getByRole("button", { name: "Existing focus" });
	previous.focus();
	await user.click(screen.getByRole("button", { name: "使用画布与设计" }));
	expect(screen.getByRole("heading", { name: "使用画布与设计" })).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "返回目录" }));
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "使用画布与设计" }));
});

it("finds a guide by the task text and preserves the filtered directory when returning", async () => {
	const user = userEvent.setup();
	render(<FeatureGuide />);
	await user.click(screen.getByRole("button", { name: "打开使用指南" }));
	const search = screen.getByRole("searchbox", { name: "搜索使用指南" });
	await user.type(search, "手机");
	expect(screen.queryByRole("button", { name: "使用画布与设计" })).toBeNull();
	await user.click(screen.getByRole("button", { name: "手机协作与远程控制" }));
	await user.click(screen.getByRole("button", { name: "返回目录" }));
	expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("手机");
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "手机协作与远程控制" }));
	await user.clear(screen.getByRole("searchbox"));
	await user.type(screen.getByRole("searchbox"), "does-not-exist");
	expect(screen.getByText("没有找到相关指南")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "清除搜索" }));
	expect(screen.getByRole("button", { name: "使用画布与设计" })).toBeTruthy();
});
