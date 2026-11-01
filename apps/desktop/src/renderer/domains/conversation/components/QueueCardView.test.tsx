// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueCardView } from "@vetta-org/theme-ui/chat";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);

it("keeps message text inert and requires the explicit send button, respecting compaction barriers", async () => {
	const user = userEvent.setup();
	const send = vi.fn();
	const remove = vi.fn();
	render(
		<QueueCardView
			items={[
				{ id: "before", displayText: "Queued message before compaction", canSendNow: true },
				{ id: "compact", displayText: "Compact context", kind: "context_compaction", canSendNow: false },
				{ id: "after", displayText: "Queued message after compaction", canSendNow: false },
			]}
			labels={{ empty: "Empty", sendNow: "Send now", delete: "Remove" }}
			onSendNow={send}
			onRemove={remove}
			onReorder={vi.fn()}
		/>,
	);
	await user.click(screen.getByText("Queued message before compaction"));
	expect(send).not.toHaveBeenCalled();
	expect(screen.getAllByRole("button", { name: "Send now" })).toHaveLength(1);
	const action = screen.getByRole("button", { name: "Send now" });
	action.focus();
	await user.keyboard("{Enter}");
	expect(send).toHaveBeenCalledExactlyOnceWith("before");
	const after = within(screen.getByText("Queued message after compaction").closest("li")!);
	expect(after.queryByRole("button", { name: "Send now" })).toBeNull();
	await user.click(after.getByRole("button", { name: "Remove" }));
	expect(remove).toHaveBeenCalledExactlyOnceWith("after");
});
