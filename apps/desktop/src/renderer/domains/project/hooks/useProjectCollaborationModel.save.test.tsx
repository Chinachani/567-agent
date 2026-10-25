/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ProjectCollaborationView } from "@vetta-org/theme-ui/project";
import type { TFunction } from "i18next";
import { afterEach, expect, it } from "vitest";
import type { ProjectCollaborationPatch, ProjectCollaborationSnapshot } from "@/shared/project-collaboration";
import { useProjectCollaborationModel } from "./useProjectCollaborationModel";

const t = ((key: string) => key) as TFunction<"project">;
afterEach(cleanup);

it("locks all member edits during save, then permits removal and a second save", async () => {
	let resolveSave!: (snapshot: ProjectCollaborationSnapshot) => void;
	let requested: ProjectCollaborationPatch | undefined;
	let resolveControl!: (snapshot: ProjectCollaborationSnapshot) => void;
	let rejectControl!: (error: Error) => void;
	const initial: ProjectCollaborationSnapshot = {
		cwd: "/project", config: { schemaVersion: 1, revision: 1, enabled: true, paused: false, coordinatorSessionId: null,
			members: [{ sessionId: "alice", responsibility: "Review", access: "read" }] },
		candidates: [{ sessionId: "alice", path: "/project/alice.jsonl", title: "Alice", preview: "Review", modifiedAt: 1, model: null, state: "idle" }], tasks: [],
	};
	Object.defineProperty(window, "agent567", { configurable: true, value: { project: {
		readCollaboration: async () => initial,
		onCollaborationChanged: () => () => {},
		controlCollaboration: () => new Promise<ProjectCollaborationSnapshot>((resolve, reject) => { resolveControl = resolve; rejectControl = reject; }),
		updateCollaboration: (_cwd: string, patch: ProjectCollaborationPatch) => {
			requested = patch;
			return new Promise<ProjectCollaborationSnapshot>((resolve) => { resolveSave = resolve; });
		},
	} } });
	const hook = renderHook(() => useProjectCollaborationModel("/project", t, "en"));
	await waitFor(() => expect(hook.result.current.members).toHaveLength(1));
	act(() => hook.result.current.onResponsibilityChange("alice", "Inspect implementation"));
	let pending!: Promise<void>;
	act(() => { pending = Promise.resolve(hook.result.current.onSave()); });
	await waitFor(() => expect(requested).toBeDefined());
	const view = render(<ProjectCollaborationView {...hook.result.current} />);
	const remove = screen.getByRole("button", { name: "collaboration.remove: Alice" }) as HTMLButtonElement;
	expect(remove.disabled).toBe(true);
	fireEvent.click(remove);
	act(() => hook.result.current.onRemove("alice"));
	expect(hook.result.current.members).toHaveLength(1);
	await act(async () => { resolveSave({ ...initial, config: { ...initial.config, ...requested, revision: 2 } }); await pending; });
	view.unmount();
	act(() => { pending = Promise.resolve(hook.result.current.onControl("pause")); });
	act(() => hook.result.current.onRemove("alice"));
	expect(hook.result.current.members).toHaveLength(1);
	await act(async () => { resolveControl({ ...initial, config: { ...initial.config, ...requested, paused: true, revision: 3 } }); await pending; });
	act(() => { pending = Promise.resolve(hook.result.current.onControl("resume")); });
	act(() => hook.result.current.onRemove("alice"));
	expect(hook.result.current.members).toHaveLength(1);
	await act(async () => { rejectControl(new Error("Temporary connection failure")); await pending; });
	expect(hook.result.current.error).toBe("Temporary connection failure");
	expect(hook.result.current.saving).toBe(false);
	act(() => hook.result.current.onRemove("alice"));
	expect(hook.result.current.members).toHaveLength(0);
	expect(hook.result.current.dirty).toBe(true);
	act(() => { pending = Promise.resolve(hook.result.current.onSave()); });
	expect(requested?.members).toEqual([]);
	await act(async () => { resolveSave({ ...initial, config: { ...initial.config, ...requested, revision: 4 } }); await pending; });
	expect(hook.result.current.members).toHaveLength(0);
	expect(hook.result.current.dirty).toBe(false);
});

it.each(["save", "pause", "continue"] as const)("releases loading when %s supersedes a change-event read", async (action) => {
	const initial: ProjectCollaborationSnapshot = {
		cwd: "/project", config: { schemaVersion: 1, revision: 1, enabled: true, paused: false, coordinatorSessionId: null, members: [] },
		candidates: [], tasks: [],
	};
	let changed!: (event: { cwd: string }) => void;
	let finishRead!: (value: ProjectCollaborationSnapshot) => void;
	let finishWrite!: (value: ProjectCollaborationSnapshot) => void;
	let first = true;
	const write = () => new Promise<ProjectCollaborationSnapshot>((resolve) => { finishWrite = resolve; });
	Object.defineProperty(window, "agent567", { configurable: true, value: { project: {
		readCollaboration: () => first ? (first = false, Promise.resolve(initial)) : new Promise<ProjectCollaborationSnapshot>((resolve) => { finishRead = resolve; }),
		onCollaborationChanged: (listener: typeof changed) => { changed = listener; return () => {}; },
		updateCollaboration: write, controlCollaboration: write,
	} } });
	const hook = renderHook(() => useProjectCollaborationModel("/project", t, "en"));
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	if (action === "save") act(() => hook.result.current.onToggleEnabled(false));
	let pending!: Promise<unknown>;
	act(() => { pending = Promise.resolve(action === "save" ? hook.result.current.onSave() : action === "pause" ? hook.result.current.onControl("pause") : hook.result.current.onContinueTask("task")); });
	act(() => changed({ cwd: "/project" }));
	expect(hook.result.current.loading).toBe(true);
	const updated = { ...initial, config: { ...initial.config, enabled: action !== "save", paused: action === "pause", revision: 2 } };
	await act(async () => { finishWrite(updated); await pending; });
	expect(hook.result.current.loading).toBe(false);
	expect(hook.result.current.saving).toBe(false);
	// A late event read must neither restore stale data nor leave editing disabled.
	await act(async () => { finishRead(initial); });
	expect(hook.result.current.enabled).toBe(updated.config.enabled);
	act(() => hook.result.current.onToggleEnabled(!updated.config.enabled));
	expect(hook.result.current.dirty).toBe(true);
});
