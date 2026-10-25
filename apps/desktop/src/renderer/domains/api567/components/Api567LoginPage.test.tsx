// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ loginWithPassword: vi.fn(async () => ({ success: false })), register: vi.fn() }));
vi.mock("../hooks/useApi567", () => ({ useApi567: () => ({ ...api, topupModalOpen: false }) }));
vi.mock("./ServiceRouteSettings", () => ({ ServiceRouteSettings: () => null }));
import { Api567LoginPage } from "./Api567LoginPage";
afterEach(cleanup);
it("supports account sign in and registration validation in English", async () => {
	initI18n();
	await i18n.changeLanguage("en");
	const user = userEvent.setup();
	render(<Api567LoginPage />);
	await user.click(screen.getByRole("button", { name: "Account" }));
	await user.type(screen.getByPlaceholderText("Enter your 567 API username"), "test-user");
	await user.type(screen.getByPlaceholderText("Enter your password"), "test-password");
	await user.click(screen.getByRole("button", { name: "Sign in and open 567 Agent" }));
	expect(api.loginWithPassword).toHaveBeenCalledWith("test-user", "test-password");
	expect(await screen.findByText("Sign-in failed. Check your username or password.")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Register" }));
	expect(screen.getByPlaceholderText("Enter the 6-digit code")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Register and sign in" })).toBeTruthy();
	await i18n.changeLanguage("zh");
});
