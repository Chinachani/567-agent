// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdateCheckerActions, UpdateCheckerDetail } from "@vetta-org/theme-ui/overlays";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
it("shows one accessible download progress with percentage and byte totals and prevents install before readiness", () => {
	render(
		<UpdateCheckerDetail
			currentVersion="1.5.0"
			latestVersion="1.5.1"
			phase="downloading"
			progress={0.44}
			downloadedBytes={30_300_000}
			totalBytes={68_500_000}
			onPrimary={vi.fn()}
			labels={{
				check: "Check",
				checking: "Checking",
				checkingBtn: "Checking",
				currentVersion: (v) => `Current ${v}`,
				download: "Download",
				downloading: (p) => `Downloading ${p}%`,
				idle: (v) => v,
				newVersion: (v) => `Version ${v}`,
				restart: "Restart",
				transferred: (a, b) => `${a} / ${b} MB`,
			}}
		/>,
	);
	const progress = screen.getByRole("progressbar", { name: "Downloading 44%" });
	expect(progress.getAttribute("aria-valuenow")).toBe("44");
	expect(progress.getAttribute("aria-valuemax")).toBe("100");
	expect(screen.getByText("30.3 / 68.5 MB")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
});

it("a user can pause an update from the version row and resume it before choosing installation", () => {
	const pause = vi.fn();
	const primary = vi.fn();
	const labels = {
		check: "Check", checking: "Checking", checkingBtn: "Checking", currentVersion: (v: string) => v,
		download: "Resume download", pause: "Pause download", downloading: (p: number) => `${p}%`, idle: (v: string) => v,
		newVersion: (v: string) => v, restart: "Restart",
	};
	const props = { currentVersion: "1.5.0", checking: false, labels, onCheck: vi.fn(), onPrimary: primary, onPause: pause };
	const view = render(<UpdateCheckerActions {...props} phase="downloading" />);
	fireEvent.click(screen.getByRole("button", { name: "Pause download" }));
	expect(pause).toHaveBeenCalledOnce();
	expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
	view.rerender(<UpdateCheckerActions {...props} phase="available" />);
	fireEvent.click(screen.getByRole("button", { name: "Resume download" }));
	expect(primary).toHaveBeenCalledOnce();
	view.rerender(<UpdateCheckerActions {...props} phase="ready" />);
	expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
});
