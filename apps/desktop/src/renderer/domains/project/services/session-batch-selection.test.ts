import { describe, expect, it } from "vitest";
import {
	selectableConversationSessions,
	toggleAllSelectedSessionPaths,
	toggleSelectedSessionPath,
} from "./session-batch-selection";
import type { SidebarConversationInfo } from "./sidebar-conversation-projection";

const conversation = (id: string): SidebarConversationInfo => ({
	kind: "conversation",
	id,
	path: `/sessions/${id}.jsonl`,
	cwd: "/workspace",
	firstMessage: id,
	modifiedAt: 1,
	access: { readHistory: true, resume: true, rename: true, delete: true },
});

const team: SidebarConversationInfo = {
	kind: "agent-team",
	id: "team-session",
	path: "/sessions/team.jsonl",
	cwd: "/workspace",
	firstMessage: "Team task",
	modifiedAt: 2,
	teamId: "team",
	teamSessionId: "team-session",
	memberAvatarUrls: [],
	sessionTitle: "Team task",
};

describe("session batch selection", () => {
	it("only selects ordinary conversations, not team sessions", () => {
		expect(selectableConversationSessions([conversation("a"), team]).map(({ id }) => id)).toEqual(["a"]);
	});

	it("toggles one path without mutating the previous selection", () => {
		const initial = new Set(["/sessions/a.jsonl"]);
		const next = toggleSelectedSessionPath(initial, "/sessions/b.jsonl");
		expect([...initial]).toEqual(["/sessions/a.jsonl"]);
		expect([...next]).toEqual(["/sessions/a.jsonl", "/sessions/b.jsonl"]);
		expect(toggleSelectedSessionPath(next, "/sessions/a.jsonl").has("/sessions/a.jsonl")).toBe(false);
	});

	it("selects all ordinary rows and clears when all are already selected", () => {
		const rows = [conversation("a"), conversation("b"), team];
		const all = toggleAllSelectedSessionPaths(new Set(), rows);
		expect([...all]).toEqual(["/sessions/a.jsonl", "/sessions/b.jsonl"]);
		expect(toggleAllSelectedSessionPaths(all, rows).size).toBe(0);
	});
});
