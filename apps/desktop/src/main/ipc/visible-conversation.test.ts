import type { IpcMainInvokeEvent, WebContents } from "electron";
import { expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
	handle: vi.fn(),
	removeHandler: vi.fn(),
	select: vi.fn(async () => {}),
	refresh: vi.fn(async () => {}),
	unsubscribe: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: fake }));
vi.mock("../conversations/visible-conversation.js", () => ({ visibleConversation: fake }));
vi.mock("../conversations/conversation-list-events.js", () => ({ onConversationListChanged: () => fake.unsubscribe }));

import { registerVisibleConversationIpc } from "./visible-conversation.js";

it("accepts only the owning main frame and bounded opaque identity, and clears on teardown", async () => {
	const owner = { mainFrame: {}, isDestroyed: () => false } as unknown as WebContents;
	const stop = registerVisibleConversationIpc(owner);
	const invoke = fake.handle.mock.calls[0][1] as (event: IpcMainInvokeEvent, id: unknown) => Promise<void>;
	const event = { sender: owner, senderFrame: owner.mainFrame } as IpcMainInvokeEvent;
	for (const untrusted of [
		{ ...event, sender: {} },
		{ ...event, senderFrame: {} },
		{ ...event, senderFrame: null },
	])
		expect(() => invoke(untrusted as IpcMainInvokeEvent, "runtime")).toThrow("Untrusted");
	expect(() => invoke(event, { title: "spoofed", path: "/secret" })).toThrow("Invalid");
	expect(() => invoke(event, "x".repeat(257))).toThrow("Invalid");
	await invoke(event, "runtime");
	expect(fake.select).toHaveBeenLastCalledWith("runtime");
	stop();
	expect(fake.select).toHaveBeenLastCalledWith(null);
	expect(fake.unsubscribe).toHaveBeenCalledOnce();
});
