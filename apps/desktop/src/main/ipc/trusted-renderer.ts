import type { IpcMainInvokeEvent, WebContents } from "electron";

export function assertTrustedMainRenderer(event: IpcMainInvokeEvent, owner: WebContents): void {
	if (owner.isDestroyed() || event.sender !== owner || !event.senderFrame || event.senderFrame !== owner.mainFrame)
		throw new Error("Untrusted renderer IPC caller");
}
