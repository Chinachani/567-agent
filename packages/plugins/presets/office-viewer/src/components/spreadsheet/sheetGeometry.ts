import { COLUMN_HEADER_HEIGHT, ROW_HEADER_WIDTH } from "./constants";
import { getColumnWidth, getRowHeight } from "./parseWorkbook";
import type { SheetModel, VisibleRange } from "./types";

// Parsed sheets are immutable snapshots. A new file read creates a new model and index.
const geometry = new WeakMap<SheetModel, { rows: Float64Array; columns: Float64Array }>();
function offsets(count: number, header: number, size: (index: number) => number): Float64Array {
	const result = new Float64Array(count + 1);
	result[0] = header;
	for (let i = 0; i < count; i++) result[i + 1] = result[i] + size(i);
	return result;
}
function indexOf(sheet: SheetModel) {
	let cached = geometry.get(sheet);
	if (!cached) {
		cached = {
			rows: offsets(sheet.rowCount, COLUMN_HEADER_HEIGHT, (row) => getRowHeight(sheet, row)),
			columns: offsets(sheet.columnCount, ROW_HEADER_WIDTH, (column) => getColumnWidth(sheet, column)),
		};
		geometry.set(sheet, cached);
	}
	return cached;
}
export function getRowTop(sheet: SheetModel, row: number): number {
	return indexOf(sheet).rows[row];
}
export function getColumnLeft(sheet: SheetModel, column: number): number {
	return indexOf(sheet).columns[column];
}
export function getSheetWidth(sheet: SheetModel): number {
	return getColumnLeft(sheet, sheet.columnCount);
}
export function getSheetHeight(sheet: SheetModel): number {
	return getRowTop(sheet, sheet.rowCount);
}

/** First cell whose trailing edge reaches the viewport, including zero-sized hidden rows. */
function boundary(offsets: Float64Array, position: number, strict: boolean): number {
	let lo = 1,
		hi = offsets.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (strict ? offsets[mid] <= position : offsets[mid] < position) lo = mid + 1;
		else hi = mid;
	}
	return lo - 1;
}
export function getVisibleRange(
	sheet: SheetModel,
	top: number,
	left: number,
	height: number,
	width: number,
	overscan: number,
): VisibleRange {
	const { rows, columns } = indexOf(sheet);
	return {
		startRow: Math.max(0, Math.min(sheet.rowCount, boundary(rows, top, false)) - overscan),
		endRow: Math.min(sheet.rowCount, boundary(rows, top + height, true) + 1 + overscan),
		startColumn: Math.max(0, Math.min(sheet.columnCount, boundary(columns, left, false)) - overscan),
		endColumn: Math.min(sheet.columnCount, boundary(columns, left + width, true) + 1 + overscan),
	};
}
