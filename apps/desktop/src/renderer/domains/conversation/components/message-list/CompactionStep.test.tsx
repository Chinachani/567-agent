// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initI18n } from "@shared/i18n";
import { CompactionStep } from "./CompactionStep";
afterEach(cleanup);
it("shows the failure reason and removes it once compaction completes", () => {
	initI18n();
	const view = render(<CompactionStep status="failed" errorMessage="Provider unavailable" />);
	expect(screen.getByRole("alert").textContent).toBe("Provider unavailable");
	view.rerender(<CompactionStep status="completed" errorMessage="Provider unavailable" />);
	expect(screen.queryByRole("alert")).toBeNull();
});
