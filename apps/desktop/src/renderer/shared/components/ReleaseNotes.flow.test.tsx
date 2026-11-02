// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UpdateReleaseHistoryView, UpdateCheckerDetail, UpdateCheckerView } from "@vetta-org/theme-ui/overlays";

afterEach(cleanup);
const body =
	"# 567 Agent 1.5.4\n\n2026-11-02\n\n## 新增\n\n- 支持 `Ctrl+B`\n- [使用说明](https://example.test/help)\n\n### 修复\n\n说明段落。";
it("renders structured notes, a date and state badge without duplicate product headings and preserves safe links", () => {
	const onOpenUrl = vi.fn();
	render(
		<UpdateReleaseHistoryView
			open
			onOpenChange={() => {}}
			loading={false}
			error=""
			range="since"
			ranges={[{ value: "since", label: "Since last update" }]}
			onRangeChange={() => {}}
			releases={[
				{
					version: "1.5.4",
					body,
					url: "https://example.test/release",
					status: "Not installed",
					statusKind: "available",
				},
			]}
			labels={{
				title: "Update history",
				description: "Release notes",
				range: "Range",
				loading: "Loading",
				empty: "Empty",
				missing: "Missing",
				retry: "Retry",
				releasePage: "Release page",
			}}
			onRetry={() => {}}
			releasePageUrl="https://example.test/releases"
			onOpenUrl={onOpenUrl}
		/>,
	);
	const dialog = screen.getByRole("dialog");
	expect(within(dialog).queryByRole("heading", { name: "567 Agent 1.5.4" })).toBeNull();
	expect(within(dialog).getByText("2026-11-02").tagName).toBe("TIME");
	expect(within(dialog).getByRole("heading", { name: "v1.5.4" })).toBeTruthy();
	expect(within(dialog).getByText("Not installed").closest("h3")).toBeNull();
	expect(within(dialog).getByRole("heading", { name: "新增" }).tagName).toBe("H2");
	expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
	expect(within(dialog).getByText("Ctrl+B").tagName).toBe("CODE");
	fireEvent.click(within(dialog).getByRole("link", { name: "使用说明" }));
	expect(onOpenUrl).toHaveBeenCalledWith("https://example.test/help");
});
it("uses the same semantic sections and lists in the compact update preview", () => {
	render(
		<UpdateCheckerDetail
			currentVersion="1.5.3"
			latestVersion="1.5.4"
			phase="available"
			onPrimary={() => {}}
			releaseNote={body}
			labels={{
				check: "Check",
				checking: "Checking",
				checkingBtn: "Checking",
				currentVersion: (v) => v,
				download: "Download",
				downloading: (p) => String(p),
				idle: (v) => v,
				newVersion: (v) => v,
				restart: "Restart",
			}}
		/>,
	);
	expect(screen.queryByRole("heading", { name: "567 Agent 1.5.4" })).toBeNull();
	expect(screen.getByRole("heading", { name: "新增" })).toBeTruthy();
	expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

it("keeps long preview links usable and offers a working full-notes action without an inert fallback button", () => {
	const more = vi.fn();
	const openUrl = vi.fn();
	const longNote = `${body}\n\n${Array.from({ length: 15 }, (_, index) => `- Change ${index}`).join("\n")}\n\n[Last change](https://example.test/last)`;
	const props = {
		checking: false,
		currentVersion: "1.5.3",
		phase: "available" as const,
		statusText: "Update available",
		onPrimary: vi.fn(),
		onCheck: vi.fn(),
		onOpenUrl: openUrl,
		releaseNote: longNote,
		labels: {
			check: "Check",
			checking: "Checking",
			checkingBtn: "Checking",
			currentVersion: (v: string) => v,
			download: "Download",
			downloading: (p: number) => String(p),
			idle: (v: string) => v,
			newVersion: (v: string) => v,
			restart: "Restart",
			viewMore: "Full release notes",
		},
	};
	const view = render(<UpdateCheckerView {...props} onViewMore={more} />);
	fireEvent.click(screen.getByRole("link", { name: "Last change" }));
	expect(openUrl).toHaveBeenCalledWith("https://example.test/last");
	fireEvent.click(screen.getByRole("button", { name: "Full release notes" }));
	expect(more).toHaveBeenCalledOnce();
	view.rerender(<UpdateCheckerView {...props} />);
	expect(screen.queryByRole("button", { name: "Full release notes" })).toBeNull();
	expect(screen.getByRole("link", { name: "Last change" })).toBeTruthy();
});
