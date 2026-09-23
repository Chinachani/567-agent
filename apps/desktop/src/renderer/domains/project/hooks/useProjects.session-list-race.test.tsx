// @vitest-environment jsdom
import { sessionsMapAtom, type SessionInfo } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetPendingSessions, useProjectActions } from "./useProjects";

const cwd = "/projects/one";
const session: SessionInfo & { access: NonNullable<SessionInfo["access"]> } = {
	id: "one",
	path: "/sessions/one.jsonl",
	cwd,
	firstMessage: "Continue work",
	modifiedAt: 1,
	access: { readHistory: true, resume: true, rename: true, delete: true },
};

beforeEach(() => {
	getDefaultStore().set(sessionsMapAtom, new Map());
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			im: { onSessionChanged: vi.fn() },
			session: { onSessionsChanged: vi.fn(), listSessions: vi.fn(async () => [] as SessionInfo[]) },
			config: { onProjectsChanged: vi.fn() },
		},
	});
});

afterEach(() => {
	forgetPendingSessions(cwd);
	forgetPendingSessions("/projects/two");
	vi.restoreAllMocks();
});

it("keeps a new cross-project session visible until the disk list confirms it", async () => {
	const { result } = renderHook(() => useProjectActions());
	await act(async () => {
		result.current.ensureLocalSession(cwd, session);
		await result.current.loadSessions(cwd);
	});
	const store = getDefaultStore();
	expect(store.get(sessionsMapAtom).get(cwd)).toContainEqual(session);

	vi.mocked(window.vetta.session.listSessions).mockResolvedValueOnce([session]);
	await act(async () => {
		await result.current.loadSessions(cwd);
	});
	expect(store.get(sessionsMapAtom).get(cwd)).toContainEqual(session);

	await act(async () => {
		await result.current.loadSessions(cwd);
	});
	expect(store.get(sessionsMapAtom).get(cwd)).toEqual([]);
});

it("keeps pending sessions isolated by project and forgets them when conversations are cleared", async () => {
	const otherCwd = "/projects/two";
	const other = { ...session, id: "two", path: "/sessions/two.jsonl", cwd: otherCwd };
	const { result } = renderHook(() => useProjectActions());
	await act(async () => {
		result.current.ensureLocalSession(cwd, session);
		result.current.ensureLocalSession(otherCwd, other);
		await Promise.all([result.current.loadSessions(cwd), result.current.loadSessions(otherCwd)]);
	});
	const store = getDefaultStore();
	expect(store.get(sessionsMapAtom).get(cwd)).toContainEqual(session);
	expect(store.get(sessionsMapAtom).get(otherCwd)).toContainEqual(other);
	result.current.forgetPendingSessions(cwd);
	await act(async () => {
		await Promise.all([result.current.loadSessions(cwd), result.current.loadSessions(otherCwd)]);
	});
	expect(store.get(sessionsMapAtom).get(cwd)).toEqual([]);
	expect(store.get(sessionsMapAtom).get(otherCwd)).toContainEqual(other);
});
