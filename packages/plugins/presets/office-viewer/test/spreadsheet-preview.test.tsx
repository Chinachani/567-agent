import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkbook } from "../src/components/spreadsheet/parseWorkbook";
import { VisibleCells } from "../src/components/spreadsheet/VisibleCells";
import { SheetTabs } from "../src/components/spreadsheet/SheetTabs";
import { isSpreadsheetExtension } from "../src/office-formats";
import { OfficePreview } from "../src/OfficePreview";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";

vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
});

const buffer = readFileSync(resolve(__dirname, "fixtures/styled-workbook.xlsx"));
const workbook = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("spreadsheet content and original appearance", () => {
	it("renders real workbook fonts, fills, alignment, borders and number formats", () => {
		const sheets = parseWorkbook(workbook);
		render(<VisibleCells sheet={sheets[0]} visible={{ startRow: 0, endRow: 10, startColumn: 0, endColumn: 11 }} />);
		const title = screen.getByText("报表标题").parentElement!;
		expect(title.style.fontWeight).toBe("700");
		expect(title.style.fontSize).toBe("24px");
		expect(title.style.color).toBe("rgb(255, 255, 255)");
		expect(title.style.backgroundColor).toBe("rgb(51, 68, 85)");
		expect(title.style.textAlign).toBe("center");
		const wrapped = screen.getByText("两行 文字").parentElement!;
		expect(wrapped.style.whiteSpace).toBe("pre-wrap");
		expect(wrapped.style.fontStyle).toBe("italic");
		expect(wrapped.style.textDecorationLine).toContain("underline");
		expect(wrapped.style.borderBottom).toContain("double");
		expect(screen.getByText("$1,234.50")).toBeTruthy();
		expect(screen.getByText("00042")).toBeTruthy();
		expect(screen.getByText("<img src=x onerror=alert(1)>").querySelector("img")).toBeNull();
		expect(sheets[0].rowHeights.get(0)).toBe(40);
		expect(sheets[0].rowHeights.get(9)).toBe(0);
		expect(sheets[0].columnWidths.get(7)).toBe(0);
	});

	it("retains a merged cell when its origin scrolls above and left of the viewport", () => {
		const [sheet] = parseWorkbook(workbook);
		const view = render(
			<VisibleCells sheet={sheet} visible={{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 5 }} />,
		);
		expect(screen.getByText("跨视口合并标题")).toBeTruthy();
		view.rerender(<VisibleCells sheet={sheet} visible={{ startRow: 3, endRow: 7, startColumn: 2, endColumn: 7 }} />);
		expect(screen.getByText("跨视口合并标题")).toBeTruthy();
	});

	it("keeps empty merged regions and styled blank cells", () => {
		const [sheet] = parseWorkbook(workbook);
		expect(sheet.cells.get("1:4")).toMatchObject({ value: "", colSpan: 2, rowSpan: 3 });
		expect(sheet.cells.get("1:9")?.style?.backgroundColor).toBe("#FFA500");
	});

	it("opens CSV and TSV as tables without converting identifiers or inventing merge information", () => {
		expect(isSpreadsheetExtension("csv")).toBe(true);
		expect(isSpreadsheetExtension("tsv")).toBe(true);
		const csv = new TextEncoder().encode('编号,说明\n00042,"中文,带逗号"\n').buffer;
		const [sheet] = parseWorkbook(csv, "csv");
		expect(sheet.cells.get("1:0")?.value).toBe("00042");
		expect(sheet.cells.get("1:1")?.value).toBe("中文,带逗号");
		expect(sheet.merges).toEqual([]);
		const tsv = new TextEncoder().encode("编号\t日期\n00042\t2026-11-02\n").buffer;
		const [tabbed] = parseWorkbook(tsv, "tsv");
		expect(tabbed.cells.get("1:1")?.value).toBe("2026-11-02");
	});

	it.each(["xls", "xlsb", "ods"] as const)("retains the existing %s data and merge preview", (format) => {
		const source = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([["Legacy data", "00042"]]);
		sheet["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
		XLSX.utils.book_append_sheet(source, sheet, "Legacy");
		const data: ArrayBuffer = XLSX.write(source, { type: "array", bookType: format });
		const [parsed] = parseWorkbook(data, format);
		expect(parsed.cells.get("0:0")?.value).toBe("Legacy data");
		expect(parsed.cells.get("0:1")?.value).toBe("00042");
	});

	it("switches between worksheets using the production sheet tabs", async () => {
		const sheets = parseWorkbook(workbook);
		const onSelect = vi.fn();
		render(<SheetTabs sheets={sheets} activeSheet={0} onSelect={onSelect} />);
		await userEvent.click(screen.getByRole("button", { name: "另一页" }));
		expect(onSelect).toHaveBeenCalledWith(1);
	});
	it("opens a workbook through the actual lazy preview, switches sheets and releases its file watcher", async () => {
		const dispose = vi.fn();
		const file: PluginPreviewFile = {
			path: "/fixture.xlsx",
			name: "fixture.xlsx",
			extension: "xlsx",
			mime: "",
			size: workbook.byteLength,
			getUrl: () => "",
			readBytes: async () => workbook,
			readText: async () => "",
			watch: () => ({ dispose }),
		};
		const view = render(<OfficePreview file={file} />);
		await screen.findByText("报表标题");
		await userEvent.click(screen.getByRole("button", { name: "另一页" }));
		expect(screen.getByText("第二个工作表")).toBeTruthy();
		view.unmount();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("opens CSV from the preview entry and explains the format's appearance limits", async () => {
		const data = new TextEncoder().encode("编号,描述\n00042,物料\n").buffer;
		const file: PluginPreviewFile = {
			path: "/fixture.csv",
			name: "fixture.csv",
			extension: "csv",
			mime: "text/csv",
			size: data.byteLength,
			getUrl: () => "",
			readBytes: async () => data,
			readText: async () => "",
			watch: () => ({ dispose: () => {} }),
		};
		render(<OfficePreview file={file} />);
		await screen.findByText("00042");
		expect(screen.getByText("spreadsheet.plainTextHint")).toBeTruthy();
	});
});
