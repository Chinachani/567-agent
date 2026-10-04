// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import type { McpAbility } from "../types";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../../shared/store/toast-atoms", () => ({ showToast }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: { language: "zh-CN" },
		t: (key: string) => (key === "unreviewedMcp.prompt" ? "收费 网络 部署 权限 参数 {{name}} {{documentation}}" : key),
	}),
}));
vi.mock("@vetta-org/ui", () => ({
	Button: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
	Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
	DialogContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
	DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("../../../shared/components/ui/textarea", () => ({
	Textarea: ({ value, ...props }: { value?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) => (
		<textarea {...props} value={value} />
	),
}));

import { UnreviewedMcpPromptDialog } from "./UnreviewedMcpPromptDialog";

const item = {
	title: "Example MCP",
	description: "Read-only data access",
	author: "Example publisher",
	version: "1.2.3",
	license: "MIT",
	origin: { repository: "https://github.com/example/mcp" },
	market: {
		detail: {
			meta: [{ key: "docs", value: "https://example.com/mcp/docs" }],
		},
	},
} as unknown as McpAbility;

describe("UnreviewedMcpPromptDialog", () => {
	it("requires explicit confirmation and copies a detailed prompt without sending it", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

		render(<UnreviewedMcpPromptDialog item={item} open onOpenChange={vi.fn()} />);

		const copyButton = screen.getByRole("button", { name: "unreviewedMcp.copy" });
		expect((copyButton as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByLabelText("unreviewedMcp.promptLabel")).toBeNull();

		fireEvent.click(screen.getByRole("checkbox"));
		const prompt = screen.getByLabelText("unreviewedMcp.promptLabel") as HTMLTextAreaElement;
		expect((copyButton as HTMLButtonElement).disabled).toBe(false);
		expect(prompt.value).toContain("收费 网络 部署 权限 参数 Example MCP https://example.com/mcp/docs");
		expect(prompt.value).not.toContain("https://github.com/example/mcp");

		fireEvent.click(copyButton);
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt.value));
		expect(screen.getByRole("status").textContent).toBe("unreviewedMcp.copied");
		expect(showToast).toHaveBeenCalled();
	});
});
