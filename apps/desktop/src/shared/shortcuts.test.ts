import { describe, expect, it } from "vitest";
import { findAnyShortcutBindingConflict } from "./shortcuts.js";

describe("findAnyShortcutBindingConflict", () => {
	it("rejects duplicate custom bindings before they are persisted", () => {
		expect(
			findAnyShortcutBindingConflict({
				"new-session": "mod+shift+n",
				"open-project": "mod+shift+n",
			}),
		).toEqual({ actionId: "new-session", conflict: "open-project", shortcut: "mod+shift+n" });
	});

	it("detects a custom binding that collides with another action's default", () => {
		expect(findAnyShortcutBindingConflict({ "new-session": "mod+o" })).toEqual({
			actionId: "new-session",
			conflict: "open-project",
			shortcut: "mod+o",
		});
	});

	it("allows defaults and shortcuts in different scopes", () => {
		expect(findAnyShortcutBindingConflict({})).toBeNull();
		expect(findAnyShortcutBindingConflict({ "steer-message": "mod+n" })).toBeNull();
	});
});
