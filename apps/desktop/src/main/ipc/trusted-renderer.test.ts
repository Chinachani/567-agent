import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { PROJECT_COLLABORATION_CHANNELS } from "../../shared/project-collaboration.js";
import { SESSION_WORKBENCH_CHANNELS } from "../../shared/session-workbench-ipc.js";

const fake = vi.hoisted(() => ({
	handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
	service: {
		readSessionWorkbench: vi.fn(async () => ({ turns: [] })),
		readSessionWorkbenchDetail: vi.fn(async () => ({ content: "saved task" })),
		readSessionAttachmentChunk: vi.fn(async () => ({ content: "file bytes" })),
		reviewSessionChange: vi.fn(async () => ({ status: "reviewed" })),
		readContextWorkspace: vi.fn(async () => ({ turns: [] })),
		updateContextSelection: vi.fn(async () => ({ revision: 2 })),
	},
	collaboration: {
		read: vi.fn(async () => ({ config: { members: [] } })),
		update: vi.fn(async () => ({ revision: 2 })),
		control: vi.fn(async () => ({ paused: true })),
		onChanged: vi.fn(() => () => {}),
	},
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
			fake.handlers.set(channel, handler),
		removeHandler: (channel: string) => fake.handlers.delete(channel),
	},
}));
vi.mock("../conversations/desktop-conversation-service.js", () => ({
	getDesktopConversationService: () => fake.service,
}));
vi.mock("../project-collaboration/service.js", () => ({ getProjectCollaborationService: () => fake.collaboration }));

import { registerProjectCollaborationHandlers } from "./project-collaboration.js";
import { registerSessionWorkbenchIpc } from "./session-workbench.js";

afterEach(() => {
	fake.handlers.clear();
	vi.clearAllMocks();
});
it("allows workbench/collaboration operations from the main frame and rejects preview/child/detached frames before domain access", async () => {
	const frame = {};
	const owner = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
	const cleanups = [registerSessionWorkbenchIpc(owner), registerProjectCollaborationHandlers(owner)];
	const valid = { sender: owner, senderFrame: frame } as unknown as IpcMainInvokeEvent;
	const entries: [string, unknown[], () => number][] = [
		[SESSION_WORKBENCH_CHANNELS.WORKBENCH, ["session"], () => fake.service.readSessionWorkbench.mock.calls.length],
		[
			SESSION_WORKBENCH_CHANNELS.WORKBENCH_DETAIL,
			["session", "tool", "id"],
			() => fake.service.readSessionWorkbenchDetail.mock.calls.length,
		],
		[
			SESSION_WORKBENCH_CHANNELS.ATTACHMENT_READ,
			["session", "id", 0, 1024],
			() => fake.service.readSessionAttachmentChunk.mock.calls.length,
		],
		[
			SESSION_WORKBENCH_CHANNELS.REVIEW_CHANGE,
			["session", "id", "restore", "revision"],
			() => fake.service.reviewSessionChange.mock.calls.length,
		],
		[
			SESSION_WORKBENCH_CHANNELS.CONTEXT_WORKSPACE,
			["session"],
			() => fake.service.readContextWorkspace.mock.calls.length,
		],
		[
			SESSION_WORKBENCH_CHANNELS.CONTEXT_SELECTION,
			["session", {}],
			() => fake.service.updateContextSelection.mock.calls.length,
		],
		[PROJECT_COLLABORATION_CHANNELS.read, ["/project"], () => fake.collaboration.read.mock.calls.length],
		[PROJECT_COLLABORATION_CHANNELS.update, ["/project", {}], () => fake.collaboration.update.mock.calls.length],
		[PROJECT_COLLABORATION_CHANNELS.control, ["/project", {}], () => fake.collaboration.control.mock.calls.length],
	];
	for (const [channel, args, count] of entries) {
		const handler = fake.handlers.get(channel)!;
		await expect(Promise.resolve(handler(valid, ...args))).resolves.toBeDefined();
		for (const event of [
			{ sender: {}, senderFrame: frame },
			{ sender: owner, senderFrame: {} },
			{ sender: owner, senderFrame: null },
		])
			expect(() => handler(event as IpcMainInvokeEvent, ...args)).toThrow(/Untrusted/);
		expect(count()).toBe(1);
	}
	for (const cleanup of cleanups) cleanup();
	expect(fake.handlers.size).toBe(0);
});
