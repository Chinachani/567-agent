/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ createPayOrder: vi.fn(), refreshQuota: vi.fn(), topupWithKey: vi.fn() }));
vi.mock("../hooks/useApi567", () => ({
	useApi567: () => {
		const [open, setOpen] = useState(true);
		return { status: { isLoggedIn: true }, topupModalOpen: open, setTopupModalOpen: setOpen, ...api };
	},
}));
import { Api567TopupModal } from "./Api567TopupModal";
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

it("shows channel unavailability and lets the user switch to redemption without creating another order", async () => {
	api.refreshQuota.mockResolvedValue({ success: true, quotaUsd: 20 });
	api.createPayOrder.mockResolvedValue({ success: false, errorCode: "payment_unavailable" });
	const user = userEvent.setup();
	render(<Api567TopupModal />);
	await user.click(screen.getByRole("button", { name: /生成付款码支付/ }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByText("在线支付暂未开放")).toBeTruthy();
	expect(screen.queryByRole("button", { name: /生成付款码支付/ })).toBeNull();
	await user.click(screen.getByRole("button", { name: "使用兑换码" }));
	expect(screen.getByPlaceholderText(/卡密|兑换码/)).toBeTruthy();
	expect(api.createPayOrder).toHaveBeenCalledOnce();
});

it("traps focus, closes with Escape, restores focus and releases background scrolling", async () => {
	const user = userEvent.setup();
	const outside = document.createElement("button");
	outside.textContent = "outside";
	document.body.append(outside);
	outside.focus();
	render(<Api567TopupModal />);
	const dialog = screen.getByRole("dialog", { name: "账户额度充值" });
	expect(document.body.getAttribute("data-scroll-locked")).toBe("1");
	await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
	for (let index = 0; index < 22; index++) await user.tab();
	expect(dialog.contains(document.activeElement)).toBe(true);
	await user.keyboard("{Escape}");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(outside));
	expect(document.body.getAttribute("data-scroll-locked")).toBeNull();
	outside.remove();
});
it("renders the payment flow in English when the application language is English", async () => {
	await i18n.changeLanguage("en");
	render(<Api567TopupModal />);
	expect(screen.getByRole("dialog", { name: "Top up balance" })).toBeTruthy();
	expect(screen.getByRole("button", { name: /Pay CNY/ })).toBeTruthy();
	await i18n.changeLanguage("zh");
});

it("ignores late balance checks after the payment dialog is closed", async () => {
	let resolve!: (value: { success: boolean; quotaUsd: number }) => void;
	api.refreshQuota.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const user = userEvent.setup();
	render(<Api567TopupModal />);
	await user.click(screen.getByRole("button", { name: /生成付款码支付/ }));
	await user.keyboard("{Escape}");
	await act(async () => resolve({ success: true, quotaUsd: 20 }));
	expect(api.createPayOrder).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
});
