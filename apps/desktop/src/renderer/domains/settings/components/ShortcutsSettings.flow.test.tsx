// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useShortcutsSettingsModel } from "./useShortcutsSettingsModel";
afterEach(cleanup);
it("lists all new bindings, edits them through desktop config and resets without losing another binding", async () => {
	initI18n();
	const set = vi.fn(async () => {});
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			config: {
				get: async () => ({ shortcuts: { bindings: { "new-session": "mod+shift+n" } } }),
				set,
				onShortcutsChanged: () => () => {},
			},
		},
	});
	const { result } = renderHook(useShortcutsSettingsModel);
	await waitFor(() =>
		expect(result.current.shortcutActions.find((a) => a.id === "new-session")?.effectiveShortcut).toBe("mod+shift+n"),
	);
	for (const [id, key] of [
		["toggle-sidebar", "mod+b"],
		["toggle-activity-panel", "mod+j"],
		["focus-input", "mod+l"],
		["stop-generation", "mod+backspace"],
	]) {
		expect(result.current.shortcutActions.find((a) => a.id === id)).toMatchObject({
			effectiveShortcut: key,
			isDefault: true,
		});
		await act(async () => result.current.onShortcutChange(id, `mod+shift+${key.split("+")[1]}`));
		expect(result.current.shortcutActions.find((a) => a.id === id)?.isDefault).toBe(false);
		await act(async () => result.current.onShortcutReset(id));
		expect(result.current.shortcutActions.find((a) => a.id === id)?.effectiveShortcut).toBe(key);
	}
	expect(set).toHaveBeenLastCalledWith({ shortcuts: { bindings: { "new-session": "mod+shift+n" } } });
});
