import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { parseWorkbook } from "../src/components/spreadsheet/parseWorkbook";
import { VisibleCells } from "../src/components/spreadsheet/VisibleCells";
import { getVisibleRange, getSheetHeight, getRowTop, getColumnLeft } from "../src/components/spreadsheet/sheetGeometry";
import type { SheetModel } from "../src/components/spreadsheet/types";
const data = readFileSync(resolve(__dirname, "fixtures/edges-and-reset.xlsx"));
const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
afterEach(cleanup);
it("merged cells preserve borders stored along all four edges", () => {
	const [sheet] = parseWorkbook(bytes);
	render(<VisibleCells sheet={sheet} visible={{ startRow: 0, endRow: 10, startColumn: 0, endColumn: 6 }} />);
	const el = screen.getByText("Merged border").parentElement!;
	console.log("merge-borders", {
		top: el.style.borderTop,
		left: el.style.borderLeft,
		right: el.style.borderRight,
		bottom: el.style.borderBottom,
	});
	expect(el.style.borderRight).toContain("3px");
	expect(el.style.borderBottom).toContain("3px");
});
it("explicit cell fill resets the row's inherited fill", () => {
	const [sheet] = parseWorkbook(bytes);
	render(<VisibleCells sheet={sheet} visible={{ startRow: 7, endRow: 9, startColumn: 0, endColumn: 3 }} />);
	const el = screen.getByText("Explicit plain").parentElement!;
	console.log("explicit-reset", { fill: el.style.backgroundColor, cell: sheet.cells.get("7:1")?.style });
	expect(el.style.backgroundColor).toBe("rgb(255, 255, 255)");
});
it("measures scroll geometry and render projection without browser painting", () => {
	for (const rows of [1000, 50000, 100000]) {
		const sheet: SheetModel = {
			name: "Large",
			cells: new Map(),
			merges: [],
			rowHeights: new Map(),
			columnWidths: new Map(),
			rowCount: rows,
			columnCount: 26,
			appearance: "plain",
		};
		const samples = [];
		for (let pass = 0; pass < 3; pass++) {
			const start = performance.now();
			getSheetHeight(sheet);
			const visible = getVisibleRange(sheet, (rows - 50) * 24, 0, 720, 1300, 4);
			VisibleCells({ sheet, visible });
			samples.push(performance.now() - start);
		}
		console.log("scroll-cost", JSON.stringify({ rows, samplesMs: samples.map((x) => Math.round(x * 10) / 10) }));
	}
});

it("indexes variable and hidden dimensions once and does not scan rows on each scroll", () => {
	const sheet: SheetModel = {
		name: "Indexed",
		cells: new Map(),
		merges: [],
		rowHeights: new Map([
			[0, 0],
			[1, 10],
			[2, 0],
			[3, 20],
		]),
		columnWidths: new Map([
			[0, 0],
			[1, 40],
			[2, 80],
		]),
		rowCount: 100000,
		columnCount: 26,
		appearance: "plain",
	};
	expect(getRowTop(sheet, 4)).toBe(60);
	expect(getColumnLeft(sheet, 3)).toBe(172);
	const rows = vi.spyOn(sheet.rowHeights, "get"),
		columns = vi.spyOn(sheet.columnWidths, "get");
	for (let i = 0; i < 100; i++) {
		const visible = getVisibleRange(sheet, 40 + i * 28, 92, 28, 40, 0);
		expect(getRowTop(sheet, visible.startRow)).toBeLessThanOrEqual(40 + i * 28);
		expect(getRowTop(sheet, visible.endRow)).toBeGreaterThanOrEqual(68 + i * 28);
	}
	expect(rows).not.toHaveBeenCalled();
	expect(columns).not.toHaveBeenCalled();
});
