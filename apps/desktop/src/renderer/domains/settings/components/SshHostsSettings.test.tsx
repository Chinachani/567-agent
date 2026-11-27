/** @vitest-environment jsdom */

import type { DesktopSshApi, SshHostSummary } from "@preload/api-types/ssh";
import { initI18n } from "@shared/i18n";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { beforeAll, expect, it, vi } from "vitest";
import { SshHostsSettings } from "./SshHostsSettings";

beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});

function renderSettings(initial: SshHostSummary[] = []) {
	const hosts = [...initial];
	const api = {
		listHosts: async () => hosts.slice(),
		onHostsChanged: () => () => undefined,
		onHostStatusChanged: () => () => undefined,
		pickPrivateKey: vi.fn<DesktopSshApi["pickPrivateKey"]>(),
		discardPrivateKey: vi.fn<DesktopSshApi["discardPrivateKey"]>().mockResolvedValue(undefined),
		createHost: vi.fn<DesktopSshApi["createHost"]>(async ({ target, label }) => {
			const host = { id: "created", target, label, source: "manual", status: "disconnected" } as const;
			hosts.push(host);
			return host;
		}),
		updateHost: vi.fn<DesktopSshApi["updateHost"]>(),
	} satisfies Partial<DesktopSshApi>;
	Object.assign(window, { agent567: { ssh: api } });
	render(<SshHostsSettings />);
	return api;
}

it("selects a key in the add dialog and retries a failed save with only the opaque reference", async () => {
	const api = renderSettings();
	api.pickPrivateKey.mockRejectedValueOnce(new Error("请选择有效的私钥文件。"));
	api.pickPrivateKey.mockResolvedValueOnce({ ref: "opaque-reference", name: "id_ed25519" });
	api.createHost.mockRejectedValueOnce(new Error("保存失败，请重试。"));
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "添加主机" }));
	const dialog = within(screen.getByRole("dialog", { name: "添加主机" }));
	await user.type(dialog.getByRole("textbox", { name: "主机地址" }), "dev@example.test");
	const choose = dialog.getByRole("button", { name: "选择私钥文件" });
	await user.click(choose);
	expect((await dialog.findByRole("alert")).textContent).toBe("请选择有效的私钥文件。");
	await user.click(choose);
	expect((await dialog.findByRole("status")).textContent).toContain("id_ed25519");
	expect(api.pickPrivateKey).toHaveBeenLastCalledWith();
	expect(api.createHost).not.toHaveBeenCalled();

	const save = dialog.getByRole("button", { name: "保存主机" });
	await user.click(save);
	expect((await dialog.findByRole("alert")).textContent).toBe("保存失败，请重试。");
	expect(dialog.getByRole("status").textContent).toContain("id_ed25519");
	await user.click(save);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(api.createHost.mock.calls).toEqual([
		[{ target: "dev@example.test", label: "dev@example.test", privateKeyRef: "opaque-reference" }],
		[{ target: "dev@example.test", label: "dev@example.test", privateKeyRef: "opaque-reference" }],
	]);
	expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
});

it("retains the previous staged key on native cancel, discards it with the dialog and supports saving the manual path", async () => {
	const host = {
		id: "build-host",
		label: "Build host",
		target: "build",
		source: "manual",
		status: "disconnected",
		identityFile: "~/.ssh/existing",
	} as const;
	const api = renderSettings([host]);
	api.pickPrivateKey.mockResolvedValueOnce({ ref: "new-key-ref", name: "backup-key" }).mockResolvedValueOnce(null);
	api.updateHost.mockResolvedValue(host);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "编辑" }));
	let dialog = within(screen.getByRole("dialog", { name: "编辑" }));
	await user.click(dialog.getByRole("button", { name: "选择私钥文件" }));
	await user.click(await dialog.findByRole("button", { name: "另选文件" }));
	expect(dialog.getByRole("status").textContent).toContain("backup-key");
	await user.click(dialog.getByRole("button", { name: "取消" }));
	await waitFor(() => expect(api.discardPrivateKey).toHaveBeenCalledWith("new-key-ref"));
	expect(api.updateHost).not.toHaveBeenCalled();

	await user.click(screen.getByRole("button", { name: "编辑" }));
	dialog = within(screen.getByRole("dialog", { name: "编辑" }));
	const path = dialog.getByRole("textbox", { name: "私钥文件" });
	expect((path as HTMLInputElement).value).toBe(host.identityFile);
	await user.clear(path);
	await user.type(path, "~/.ssh/replacement");
	await user.click(dialog.getByRole("button", { name: "保存主机" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(api.updateHost).toHaveBeenCalledWith({
		id: host.id,
		label: host.label,
		target: host.target,
		identityFile: "~/.ssh/replacement",
	});
});

it("edits an existing host with a replacement key and discards a selection when switching to password", async () => {
	const host = {
		id: "build-host",
		label: "Build host",
		target: "build",
		source: "manual",
		status: "disconnected",
	} as const;
	const api = renderSettings([host]);
	api.pickPrivateKey
		.mockResolvedValueOnce({ ref: "discarded-on-password", name: "first-key" })
		.mockResolvedValueOnce({ ref: "replacement-key", name: "second-key" });
	api.updateHost.mockResolvedValue(host);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "编辑" }));
	const dialog = within(screen.getByRole("dialog", { name: "编辑" }));
	await user.click(dialog.getByRole("button", { name: "选择私钥文件" }));
	await dialog.findByText("first-key");
	await user.click(dialog.getByRole("button", { name: "密码" }));
	expect(dialog.getByLabelText("登录密码")).toBeTruthy();
	expect(api.discardPrivateKey).toHaveBeenCalledWith("discarded-on-password");
	await user.click(dialog.getByRole("button", { name: "私钥" }));
	await user.click(dialog.getByRole("button", { name: "选择私钥文件" }));
	await dialog.findByText("second-key");
	await user.click(dialog.getByRole("button", { name: "保存主机" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(api.updateHost).toHaveBeenCalledWith({
		id: host.id,
		label: host.label,
		target: host.target,
		privateKeyRef: "replacement-key",
	});
});
