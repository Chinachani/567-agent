import { describe, expect, it } from "vitest";
import { projectTaskNotifications } from "./task-notifications";

const completed = `<task-notification> <task-id>b44</task-id> <tool-use-id>bash-test</tool-use-id>
<status>completed</status> <output-file>/tmp/task.log</output-file>
<summary>Background command completed (exit code 0)</summary> </task-notification>`;
const label = (id: string, status: string) => `Task ${id}: ${status}`;
const guidance = "Use the task_output tool to read the command output if needed.";

describe("echoed task notification display", () => {
	it.each(["completed", "failed", "killed"])(
		"summarizes a complete %s notification and exact output instruction",
		(status) => {
			const source = `**Before**\n\n${completed.replace("<status>completed", `<status>${status}`)}\n${guidance}\n\nAfter.`;
			expect(projectTaskNotifications(source, label)).toBe(`**Before**\n\n> Task b44: ${status}\n\n\n\nAfter.`);
		},
	);

	it.each([
		(source: string) => `\x60\x60\x60xml\n${source}\n\x60\x60\x60`,
		(source: string) => `~~~xml\n${source}\n~~~`,
		(source: string) =>
			source
				.split("\n")
				.map((line) => `    ${line}`)
				.join("\n"),
		(source: string) => `\x60\n${source.replaceAll("\n", " ")}\n\x60`,
		(source: string) =>
			source
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n"),
	])("keeps literal code and quoted examples unchanged", (wrap) => {
		const source = wrap(completed);
		expect(projectTaskNotifications(source, label)).toBe(source);
	});

	it.each([
		completed.replace("</task-notification>", ""),
		completed.replace("<task-id>b44</task-id>", ""),
		completed.replace("<status>completed", "<status>running"),
		completed.replace("<task-id>b44", "<task-id>external-44"),
		completed.replace("<output-file>/tmp/task.log", "<output-file>"),
		completed.replace("<summary>", "<extra>unknown</extra><summary>"),
		completed.replace("<summary>", `<summary>${"x".repeat(16_384)}`),
		`<task-notification>\n${completed}\n</task-notification>`,
		`<task-notification>\n${"x".repeat(16_384)}\n${completed}\n</task-notification>`,
		`${completed} This is an example.`,
		`Example: ${completed}`,
		"<task-notification><status>completed</status></task-notification>",
		"The prompt could not be submitted. The prompt contains sensitive words.",
	])("preserves incomplete, unknown, oversized and ordinary content", (source) => {
		expect(projectTaskNotifications(source, label)).toBe(source);
	});

	it("handles repeated CRLF notifications, preserving unrelated instructions", () => {
		const source =
			`${completed}\n${guidance}\n\n${completed.replace("b44", "b45")}\nUse a different tool.`.replaceAll(
				"\n",
				"\r\n",
			);
		const result = projectTaskNotifications(source, label);
		expect(result).toContain("> Task b44: completed");
		expect(result).toContain("> Task b45: completed");
		expect(result).not.toContain("<task-notification>");
		expect(result).toContain("Use a different tool.");
	});

	it("summarizes caller cancellation but retains the canonical source and unrelated prose", () => {
		const source =
			completed.replace("<status>completed</status>", "<status>killed</status><ended-by>caller</ended-by>") +
			`\n\nThe user manually stopped this background task. Do not restart it unless the user asks.\n\n${guidance}\n\nKeep the server stopped.`;
		expect(projectTaskNotifications(source, label)).toBe("> Task b44: killed\n\n\n\nKeep the server stopped.");
		expect(source).toContain("Do not restart it unless the user asks.");
	});

	it("projects the legacy prose notification emitted by older persisted sessions", () => {
		const legacy =
			`<task-notification>Task b34 completed with exit code 0. Command: ssh host yarn build\n` +
			`Output file: /tmp/vetta-task-b34.log\nFinal output: build completed</task-notification>`;
		const source = `Before\n\n${legacy}\n\nAfter`;
		expect(projectTaskNotifications(source, label)).toBe("Before\n\n> Task b34: completed\n\n\n\nAfter");
	});

	it("keeps legacy notification examples inside code blocks literal", () => {
		const legacy =
			`<task-notification>Task b34 completed with exit code 0. Command: echo ok ` +
			`Output file: /tmp/task.log Final output: ok</task-notification>`;
		const source = `\`\`\`text\n${legacy}\n\`\`\``;
		expect(projectTaskNotifications(source, label)).toBe(source);
	});
});
