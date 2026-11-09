// @vitest-environment jsdom

import { RendererMarkdownContent } from "@shared/components/RendererMarkdownContent";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { useMarkdownLabels } from "@shared/hooks/useMarkdownLabels";
import { initI18n } from "@shared/i18n";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import i18n from "i18next";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { TextBlockView } from "./TextBlock";

const notification = `<task-notification> <task-id>b44</task-id> <tool-use-id>bash-test</tool-use-id>
<status>completed</status> <output-file>/tmp/task.log</output-file>
<summary>Background command completed (exit code 0)</summary> </task-notification>
Use the task_output tool to read the command output if needed.`;

const environment = {
	theme: "dark" as const,
	labels: {
		copy: "Copy",
		copied: "Copied",
		backgroundTask: (id: string, status: string) => `后台任务 ${id} · ${status}`,
	},
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("renders a complete echoed internal notification as status while preserving surrounding Markdown", () => {
	const source = `**检查完成**\n\n${notification}\n\n继续检查。`;
	const view = render(<MarkdownContent {...environment} text={source} />);
	expect(screen.getByText("后台任务 b44 · completed")).toBeTruthy();
	expect(screen.getByText("检查完成").tagName).toBe("STRONG");
	expect(screen.getByText("继续检查。")).toBeTruthy();
	expect(view.container.textContent).not.toContain("<task-notification>");
	expect(view.container.textContent).not.toContain("task_output");
	expect(source).toContain("<output-file>/tmp/task.log</output-file>");
});

it("renders the legacy prose notification from persisted sessions through the conversation adapter", () => {
	const legacy =
		"<task-notification>Task b34 completed with exit code 0. Command: echo ok\n" +
		"Output file: /tmp/task-b34.log\nFinal output: ok</task-notification>";
	const view = render(
		<RendererMarkdownScope value={environment}>
			<TextBlockView text={legacy} />
		</RendererMarkdownScope>,
	);
	expect(view.container.textContent).toContain("后台任务 b34 · completed");
	expect(view.container.textContent).not.toContain("<task-notification>");
});

it("preserves literal code, unknown or incomplete notifications, and normal provider refusal text", () => {
	const source = `\`\`\`text\n${notification}\n\`\`\`\n\n<task-notification><status>completed</status></task-notification>\n\nThe prompt could not be submitted. Try rephrasing the prompt.`;
	const view = render(<MarkdownContent {...environment} text={source} />);
	expect(view.container.querySelector("code")?.textContent).toContain("<task-notification>");
	expect(view.container.textContent).toContain("<task-notification><status>completed</status></task-notification>");
	expect(view.container.textContent).toContain("The prompt could not be submitted.");
	expect(screen.queryByText("后台任务 b44 · completed")).toBeNull();
});

it("does not reinterpret user messages with structured inline references", () => {
	const view = render(
		<MarkdownContent
			{...environment}
			text={notification}
			inlineTokens={{ parse: (text) => [{ kind: "text", text }], annotations: [], getImageLabel: () => "Image" }}
		/>,
	);
	expect(view.container.textContent).toContain("<task-notification>");
	expect(screen.queryByText("后台任务 b44 · completed")).toBeNull();
});

it("uses localized conversation labels through the production text adapter while literal documents remain intact", () => {
	function Harness({ context }: { context: "conversation" | "document" }) {
		const labels = useMarkdownLabels(context);
		return (
			<RendererMarkdownScope value={{ ...environment, labels }}>
				{context === "conversation" ? (
					<TextBlockView text={notification} />
				) : (
					<RendererMarkdownContent text={notification} />
				)}
			</RendererMarkdownScope>
		);
	}
	const view = render(<Harness context="conversation" />);
	expect(screen.getByText("后台任务 b44 · 已完成")).toBeTruthy();
	view.rerender(<Harness context="document" />);
	expect(view.container.textContent).toContain("<task-notification>");
	expect(screen.queryByText("后台任务 b44 · 已完成")).toBeNull();
});

it("converges from a partial stream to the same final status without retaining raw notification text", () => {
	vi.useFakeTimers();
	const view = render(<MarkdownContent {...environment} text={notification.slice(0, 100)} isStreamingTail />);
	act(() => vi.runAllTimers());
	expect(screen.queryByText("后台任务 b44 · completed")).toBeNull();
	view.rerender(<MarkdownContent {...environment} text={`${notification}\n\nFinished.`} isStreamingTail={false} />);
	act(() => vi.runAllTimers());
	expect(view.container.textContent).toContain("后台任务 b44 · completed");
	expect(view.container.textContent).toContain("Finished.");
	expect(view.container.textContent).not.toContain("<task-notification>");
});

it("projects a signal termination echo adjacent to the answer through the live conversation renderer", () => {
	const source =
		'<task-notification>Task b8 ("python3 server.py") terminated with signal SIGKILL. Summary: 0 lines of output, exit code -9 (killed by signal 9).</task-notification>已经完成 **说明文档**。';
	const view = render(
		<RendererMarkdownScope value={environment}>
			<TextBlockView text={source} />
		</RendererMarkdownScope>,
	);
	expect(view.container.textContent).toContain("后台任务 b8 · killed");
	expect(view.container.textContent).toContain("已经完成 说明文档。");
	expect(screen.getByText("说明文档").tagName).toBe("STRONG");
	expect(view.container.textContent).not.toContain("task-notification");
	expect(view.container.textContent).not.toContain("python3 server.py");
	expect(source).toContain("SIGKILL");
});
