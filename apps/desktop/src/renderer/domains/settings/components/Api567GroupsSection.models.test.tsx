/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { confirmDialogAtom } from "@shared/store/atoms";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
	setImageGroup: vi.fn(),
	removeGroup: vi.fn(),
	setImageModel: vi.fn(),
	setActiveGroup: vi.fn(),
	modelName: "talk",
	syncGroup: vi.fn(),
	refreshQuota: vi.fn(),
	loadAvailableGroups: vi.fn(),
	refreshGroups: vi.fn(),
}));
vi.mock("../../api567/hooks/useApi567", () => ({
	useApi567: () => ({
		status: {
			isLoggedIn: true,
			activeGroup: "chat",
			activeModel: api.modelName,
			imageGroup: "chat",
			imageModel: "old",
			groups: [
				{ name: "art", models: ["image-a", "image-b"], imageModels: ["image-a", "image-b"] },
				{ name: "chat", models: ["talk", "talk-fast", "old"], imageModels: ["old"] },
				{ name: "otherChat", models: ["other-talk"], imageModels: [] },
			],
		},
		availableGroups: {
			art: { ratio: 1 },
			chat: { ratio: 1 },
			otherChat: { ratio: 1 },
			newChat: { ratio: 1 },
			newArt: { ratio: 1 },
		},
		groupsLoadState: {},
		...api,
	}),
}));
vi.mock("../../api567", () => ({ ServiceRouteSettings: () => null }));
import { Api567GroupsSection } from "./Api567GroupsSection";
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});
beforeEach(() => {
	api.modelName = "talk";
});

it.each([true, false])(
	"sets an exact primary model and highlights only a saved choice (success=%s)",
	async (success) => {
		let finish!: (value: { success: boolean }) => void;
		api.setActiveGroup.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const user = userEvent.setup();
		render(<Api567GroupsSection config={{ providers: {} }} />);
		await user.click(screen.getByRole("button", { name: "查看 chat 的模型" }));
		expect(screen.getByRole("button", { name: "talk", pressed: true })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "talk-fast" }));
		expect(api.setActiveGroup).toHaveBeenCalledWith("chat", "talk-fast");
		expect(screen.getByRole("button", { name: "talk-fast" }).hasAttribute("disabled")).toBe(true);
		await act(async () => {
			if (success) api.modelName = "talk-fast";
			finish({ success });
		});
		expect(screen.getByRole("button", { name: success ? "talk-fast" : "talk", pressed: true })).toBeTruthy();
		expect(screen.getByRole("button", { name: "talk-fast" }).hasAttribute("disabled")).toBe(false);
	},
);

it("selects a primary model in another group in the same request", async () => {
	api.setActiveGroup.mockResolvedValue({ success: true });
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getByRole("button", { name: "查看 otherChat 的模型" }));
	await user.click(screen.getByRole("button", { name: "other-talk" }));
	expect(api.setActiveGroup).toHaveBeenCalledWith("otherChat", "other-talk");
});

it("lists image-only models once and switches their group before choosing a default", async () => {
	api.setImageGroup.mockResolvedValue({ success: true });
	api.setImageModel.mockResolvedValue({ success: true });
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getByRole("button", { name: "查看 art 的模型" }));
	expect(screen.queryByRole("region", { name: "主力模型" })).toBeNull();
	const images = screen.getByRole("region", { name: "生图模型" });
	expect(within(images).getAllByText("image-a")).toHaveLength(1);
	await user.click(within(images).getByRole("button", { name: "image-a" }));
	expect(api.setImageGroup).toHaveBeenCalledWith("art");
	expect(api.setImageModel).toHaveBeenCalledWith("image-a");
	expect(api.setImageGroup.mock.invocationCallOrder[0]).toBeLessThan(api.setImageModel.mock.invocationCallOrder[0]);
});

it("does not change the old group's image model when selecting the new group fails", async () => {
	api.setImageGroup.mockResolvedValue({ success: false });
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getByRole("button", { name: "查看 art 的模型" }));
	await user.click(screen.getByRole("button", { name: "image-a" }));
	expect(api.setImageModel).not.toHaveBeenCalled();
});

it.each([true, false])(
	"keeps other groups' labels while refreshing one group and unlocks after success=%s",
	async (success) => {
		let finish!: (value: { success: boolean }) => void;
		api.syncGroup.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const user = userEvent.setup();
		render(<Api567GroupsSection config={{ providers: {} }} />);
		await user.click(screen.getByRole("button", { name: "art 的更多操作" }));
		await user.click(screen.getByRole("menuitem", { name: "刷新模型" }));
		expect(api.syncGroup).toHaveBeenCalledWith("art");
		expect(screen.queryByText("接入中...")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe("刷新中…");
		const connect = screen.getAllByRole("button", { name: "一键接入" });
		expect(connect).toHaveLength(2);
		for (const button of connect) expect(button.hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "chat 的更多操作" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByTitle("刷新余额与状态").hasAttribute("disabled")).toBe(true);
		await act(async () => finish({ success }));
		expect(screen.queryByText("刷新中…")).toBeNull();
		for (const button of screen.getAllByRole("button", { name: "一键接入" })) {
			expect(button.hasAttribute("disabled")).toBe(false);
		}
		expect(screen.getByRole("button", { name: "chat 的更多操作" }).hasAttribute("disabled")).toBe(false);
	},
);

it("shows progress only for the group being connected, then restores both buttons", async () => {
	let finish!: (value: { success: boolean }) => void;
	api.syncGroup.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getAllByRole("button", { name: "一键接入" })[0]!);
	expect(api.syncGroup).toHaveBeenCalledWith("newChat");
	expect(screen.getAllByRole("button", { name: "接入中..." })).toHaveLength(1);
	expect(screen.getByRole("button", { name: "一键接入" }).hasAttribute("disabled")).toBe(true);
	await act(async () => finish({ success: true }));
	expect(screen.queryByText("接入中...")).toBeNull();
	expect(screen.getAllByRole("button", { name: "一键接入" })).toHaveLength(2);
});

it("keeps per-group labels during a global refresh", async () => {
	let finish!: () => void;
	api.refreshQuota.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getByTitle("刷新余额与状态"));
	expect(screen.queryByText("接入中...")).toBeNull();
	for (const button of screen.getAllByRole("button", { name: "一键接入" })) {
		expect(button.hasAttribute("disabled")).toBe(true);
	}
	await act(async () => finish());
	expect(api.refreshGroups).toHaveBeenCalledOnce();
	for (const button of screen.getAllByRole("button", { name: "一键接入" })) {
		expect(button.hasAttribute("disabled")).toBe(false);
	}
});

it("requires confirmation before removing a group", async () => {
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	await user.click(screen.getByRole("button", { name: i18n.t("settings:api567Models.more", { group: "art" }) }));
	await user.click(screen.getByRole("menuitem", { name: i18n.t("settings:api567Models.remove") }));
	expect(api.removeGroup).not.toHaveBeenCalled();
	const confirmation = getDefaultStore().get(confirmDialogAtom);
	expect(confirmation?.message).toContain("art");
	act(() => confirmation?.onConfirm(false));
	expect(api.removeGroup).toHaveBeenCalledWith("art");
});

it("finds a group by model ID, keeps selection actions and restores all groups after clearing", async () => {
	api.setImageGroup.mockResolvedValue({ success: true });
	api.setImageModel.mockResolvedValue({ success: true });
	const user = userEvent.setup();
	render(<Api567GroupsSection config={{ providers: {} }} />);
	const search = screen.getByRole("searchbox", { name: "搜索分组或模型" });
	await user.type(search, "IMAGE-A");
	expect(screen.queryByRole("button", { name: "查看 chat 的模型" })).toBeNull();
	await user.click(screen.getByRole("button", { name: "查看 art 的模型" }));
	await user.click(screen.getByRole("button", { name: "image-a" }));
	expect(api.setImageGroup).toHaveBeenCalledWith("art");
	await user.clear(search);
	await user.type(search, "not-a-model");
	expect(screen.getByText("没有匹配的分组或模型")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "清除搜索" }));
	expect(screen.getByRole("button", { name: "查看 chat 的模型" })).toBeTruthy();
});
