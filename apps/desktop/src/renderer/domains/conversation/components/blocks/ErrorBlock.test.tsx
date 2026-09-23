// @vitest-environment jsdom
import type { ErrorBlock } from "@shared/store/atoms";
import { initI18n } from "@shared/i18n";
import { appendError, historyToChat } from "../../services/chat-service";
import { render, screen, fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorBlockView } from "./ErrorBlock";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

function liveError(text: string, details?: ErrorBlock["details"]): ErrorBlock {
	const messages = appendError([], text, undefined, "turn-1", details);
	return messages.flatMap((message) =>
		message.kind === "agent" ? message.blocks.filter((block): block is ErrorBlock => block.type === "error") : [],
	)[0]!;
}

beforeAll(() => {
	initI18n();
	void i18n.changeLanguage("zh");
});

describe("conversation error presentation", () => {
	it("explains a stopped run while keeping runtime diagnostics available", () => {
		const text = "Agent run ended with status: max_model_calls";
		render(<ErrorBlockView block={liveError(text, { code: "turn_failed", origin: "runtime" })} />);

		expect(screen.getByText("执行已中断")).toBeTruthy();
		expect(screen.getByText("本次运行已达到模型调用次数上限，可继续发送消息接着处理。")).toBeTruthy();
		expect(screen.getByText("错误")).toBeTruthy();
		const detail = screen.getByRole("button", { name: "查看详情" });
		fireEvent.click(detail);
		expect(detail.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText(/错误码：turn_failed/)).toBeTruthy();
		expect(screen.getByText(text)).toBeTruthy();
	});

	it("recognizes a model-call limit in restored conversation history", () => {
		const messages = historyToChat([
			{ role: "user", content: "Continue the task" },
			{ role: "assistant", content: [], stopReason: "error", errorMessage: "Agent run ended with status: max_model_calls" },
		]);
		const block = messages.flatMap((message) =>
			message.kind === "agent" ? message.blocks.filter((entry): entry is ErrorBlock => entry.type === "error") : [],
		)[0]!;
		render(<ErrorBlockView block={block} />);
		expect(screen.getByText("执行已中断")).toBeTruthy();
		expect(screen.getByText("错误")).toBeTruthy();
	});

	it.each([
		["connect ECONNREFUSED 127.0.0.1", "警告", "网络没连上"],
		["401 Unauthorized", "错误", "模型密钥无效或已过期"],
	])("labels %s as %s", (text, severity, title) => {
		render(<ErrorBlockView block={liveError(text)} />);
		expect(screen.getByText(severity)).toBeTruthy();
		expect(screen.getByText(title)).toBeTruthy();
	});

	it("marks failed persistence as critical without claiming work was lost", () => {
		render(<ErrorBlockView block={liveError("Turn terminal state could not be persisted", { code: "turn_persistence", origin: "runtime" })} />);
		expect(screen.getByText("严重")).toBeTruthy();
		expect(screen.getByText("会话状态未能保存")).toBeTruthy();
	});
});
