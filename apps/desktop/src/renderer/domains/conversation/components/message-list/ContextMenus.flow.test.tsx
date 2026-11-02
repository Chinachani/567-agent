// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createConversationUserMessage } from "@shared/conversation";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { initI18n, i18n } from "@shared/i18n";
import { MarkdownHostProvider, ResourceMenu, type MarkdownHost } from "@vetta-org/theme-ui/markdown";
import {
	UserMessageContextMenuView,
	MessageSelectionContextMenuView,
	InputBarContextMenuView,
} from "@vetta-org/theme-ui/chat";
import { useUserMessageContextMenu } from "../../hooks/useUserMessageActions";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";
import { UserMessage } from "./UserMessage";

const copy = vi.fn(async () => {});
const reveal = vi.fn(async () => {});
const host: MarkdownHost = {
	copyText: copy,
	revealFile: reveal,
	openExternalUrl: vi.fn(async () => {}),
	openHtml: async () => () => {},
	renderMermaid: async () => "",
	favicon: async () => null,
	resolveImage: async (s) => s,
	copyImage: vi.fn(async () => {}),
	saveImage: vi.fn(async () => {}),
	openImage: vi.fn(),
};
const markdown = {
	theme: "dark" as const,
	host,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};
function Harness({ attachments = false }: { attachments?: boolean }) {
	const menu = useUserMessageContextMenu({
		canCopy: true,
		canEdit: true,
		canDelete: true,
		onCopy: copy,
		onEdit: () => {},
		onDelete: () => {},
	});
	const selection = useMessageSelectionContextMenu();
	return (
		<RendererMarkdownScope value={markdown}>
			<MarkdownHostProvider host={host}>
				<div ref={selection.containerRef} onContextMenuCapture={selection.onContextMenuCapture}>
					{attachments ? (
						<UserMessage
							onContextMenu={menu.onContextMenu}
							message={createConversationUserMessage({
								id: "u",
								text: "",
								attachments: [
									{ kind: "file", path: "/tmp/report.csv" },
									{ kind: "image", path: "/tmp/photo.png" },
								],
							})}
						/>
					) : (
						<div onContextMenu={menu.onContextMenu}>
							<span>Selected prose</span>
							<span>Unselected prose</span>
							<button onContextMenu={(e) => e.preventDefault()}>Already claimed</button>
							<ResourceMenu kind="file" target="/tmp/report.csv" labels={markdown.labels} open={() => {}}>
								<button>File capsule</button>
							</ResourceMenu>
						</div>
					)}
				</div>
				{menu.model && <UserMessageContextMenuView {...menu.model} />}
				{selection.contextMenu && <MessageSelectionContextMenuView {...selection.contextMenu} />}
			</MarkdownHostProvider>
		</RendererMarkdownScope>
	);
}
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	copy.mockClear();
	reveal.mockClear();
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: { skills: { list: async () => [] }, abilities: { listOpenMarketplaces: async () => ({ abilities: [] }) } },
	});
});
afterEach(() => {
	cleanup();
	window.getSelection()?.removeAllRanges();
});

it("lets a resource own right click, copies its path and never opens message deletion", async () => {
	render(<Harness />);
	fireEvent.contextMenu(screen.getByText("File capsule"));
	expect(await screen.findByRole("menuitem", { name: "Copy path" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
	fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
	await waitFor(() => expect(copy).toHaveBeenCalledWith("/tmp/report.csv", "file"));
	fireEvent.contextMenu(screen.getByText("Already claimed"));
	expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
});
it("keeps a residual text selection from hijacking resources or unrelated prose and closes the old menu", async () => {
	render(<Harness />);
	const text = screen.getByText("Selected prose");
	const range = document.createRange();
	range.selectNodeContents(text);
	window.getSelection()?.addRange(range);
	fireEvent.contextMenu(text);
	expect(screen.getByRole("button", { name: "添加到输入框" })).toBeTruthy();
	fireEvent.contextMenu(screen.getByText("File capsule"));
	expect(await screen.findByRole("menuitem", { name: "Copy path" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "添加到输入框" })).toBeNull();
	fireEvent.keyDown(document, { key: "Escape" });
	fireEvent.contextMenu(screen.getByText("Unselected prose"));
	expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "添加到输入框" })).toBeNull();
	fireEvent.blur(window);
	expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
});
it.each(["report.csv", "photo.png"])("gives the real %s attachment its own file menu", async (name) => {
	render(<Harness attachments />);
	fireEvent.contextMenu(name.endsWith("png") ? screen.getByRole("img", { name }) : screen.getByText(name));
	expect(await screen.findByRole("menuitem", { name: "Show in file manager" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
	fireEvent.click(screen.getByRole("menuitem", { name: "Show in file manager" }));
	await waitFor(() => expect(reveal).toHaveBeenCalledWith(`/tmp/${name}`));
});
it("dismisses the input menu on another right click and releases listeners on unmount", () => {
	const onClose = vi.fn();
	const view = render(
		<InputBarContextMenuView
			x={0}
			y={0}
			canCopy
			canCut
			canPaste
			onClose={onClose}
			onCopy={() => {}}
			onCut={() => {}}
			onPaste={() => {}}
			labels={{ copy: "Copy input", cut: "Cut", paste: "Paste" }}
		/>,
	);
	fireEvent.contextMenu(document.body);
	expect(onClose).toHaveBeenCalledTimes(1);
	fireEvent.blur(window);
	expect(onClose).toHaveBeenCalledTimes(2);
	view.unmount();
	fireEvent.contextMenu(document.body);
	fireEvent.blur(window);
	expect(onClose).toHaveBeenCalledTimes(2);
});
