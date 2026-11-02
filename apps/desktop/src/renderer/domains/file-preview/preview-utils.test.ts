// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@shared/store/toast-atoms", () => ({ showToast: toast }));
vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));

import { downloadItem } from "./preview-utils";

beforeEach(() => {
	vi.restoreAllMocks();
	toast.mockClear();
});

it("saves an unsupported local file through the existing native copy dialog", async () => {
	const saveCopy = vi.fn(async () => null);
	Object.defineProperty(window, "agent567", { configurable: true, value: { dialog: { saveCopy } } });
	await downloadItem({ name: "legacy.doc", path: "/work/legacy.doc" });
	expect(saveCopy).toHaveBeenCalledWith("/work/legacy.doc", { defaultFileName: "legacy.doc" });
	expect(toast).not.toHaveBeenCalled();
});

it("reports a failed remote download without saving the HTTP error page as a document", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("not found", { status: 404 })),
	);
	await downloadItem({ name: "report.pdf", url: "https://example.invalid/report.pdf" });
	expect(toast).toHaveBeenCalledWith({ variant: "error", message: "chat:fileEditor.errorDownload" });
	vi.unstubAllGlobals();
});
