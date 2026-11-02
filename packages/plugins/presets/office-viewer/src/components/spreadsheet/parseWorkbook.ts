import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "./constants";
import { createCellKey } from "./cellKeys";
import type { SheetCell, SheetMerge, SheetModel } from "./types";
import { readWorkbookAppearance, type WorksheetAppearance } from "./workbookAppearance";

const MIN_ROW_COUNT = 100;
const MIN_COLUMN_COUNT = 26;

export function parseWorkbook(bytes: ArrayBuffer, extension?: string): SheetModel[] {
	const plain = extension === "csv" || extension === "tsv";
	// IPC and browser fetch can supply ArrayBuffers from different realms.
	const data = plain ? decodeDelimitedText(bytes) : new Uint8Array(bytes);
	const workbook = XLSX.read(data, {
		type: plain ? "string" : "array",
		raw: plain,
		FS: extension === "tsv" ? "\t" : undefined,
		cellDates: true,
		cellStyles: true,
		sheetStubs: true,
		bookFiles: !plain,
	});
	const appearances = readWorkbookAppearance(workbook);
	return workbook.SheetNames.map((name) => {
		const worksheet = workbook.Sheets[name];
		const range = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;
		const merges = parseMerges(worksheet);
		const appearance = appearances.get(name);
		const cells = parseCells(worksheet, merges, appearance);
		return {
			name,
			cells,
			merges,
			rowHeights: parseRowHeights(worksheet),
			columnWidths: parseColumnWidths(worksheet),
			rowCount: merges.reduce(
				(max, merge) => Math.max(max, merge.endRow + 1),
				Math.max(MIN_ROW_COUNT, range ? range.e.r + 1 : 0),
			),
			columnCount: merges.reduce(
				(max, merge) => Math.max(max, merge.endColumn + 1),
				Math.max(MIN_COLUMN_COUNT, range ? range.e.c + 1 : 0),
			),
			defaultStyle: appearance?.defaultStyle,
			defaultRowHeight: appearance?.defaultRowHeight,
			defaultColumnWidth: appearance?.defaultColumnWidth,
			rowStyles: appearance?.rows,
			columnStyles: appearance?.columns,
			appearance: plain ? "plain" : appearance ? "styles" : "values",
		};
	});
}

function parseCells(
	worksheet: XLSX.WorkSheet,
	merges: SheetMerge[],
	appearance?: WorksheetAppearance,
): Map<string, SheetCell> {
	const cells = new Map<string, SheetCell>();
	const mergeEdges = new Map<SheetMerge, CSSProperties>();
	for (const address of new Set([...Object.keys(worksheet), ...(appearance?.cells.keys() ?? [])])) {
		if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
		const position = XLSX.utils.decode_cell(address);
		const sourceCell: XLSX.CellObject | undefined = worksheet[address];
		const value = formatCellValue(sourceCell);
		const style = appearance?.cells.get(address);
		if (value.length === 0 && !style) continue;
		const merge = findMerge(merges, position.r, position.c);
		if (merge && style) {
			const edges = mergeEdges.get(merge) ?? {};
			for (const [side, onEdge] of [
				["borderTop", position.r === merge.startRow],
				["borderBottom", position.r === merge.endRow],
				["borderLeft", position.c === merge.startColumn],
				["borderRight", position.c === merge.endColumn],
			] as const) {
				const value = style[side];
				if (onEdge && value && value !== "none" && value !== "1px solid #e5e7eb") edges[side] = value;
			}
			mergeEdges.set(merge, edges);
		}
		cells.set(createCellKey(position.r, position.c), {
			value,
			title: createCellTitle(sourceCell, value),
			style: {
				...(sourceCell?.t === "n" || sourceCell?.t === "d" ? { textAlign: "right" as const } : {}),
				...style,
			},
			colSpan: merge && isMergeOrigin(merge, position.r, position.c) ? merge.endColumn - merge.startColumn + 1 : 1,
			rowSpan: merge && isMergeOrigin(merge, position.r, position.c) ? merge.endRow - merge.startRow + 1 : 1,
		});
	}
	// A merge may be empty or its origin may be omitted by a spreadsheet writer.
	for (const merge of merges) {
		const key = createCellKey(merge.startRow, merge.startColumn);
		const cell = cells.get(key) ?? { value: "", title: "", colSpan: 1, rowSpan: 1 };
		cells.set(key, {
			...cell,
			style: { ...cell.style, ...mergeEdges.get(merge) },
			colSpan: merge.endColumn - merge.startColumn + 1,
			rowSpan: merge.endRow - merge.startRow + 1,
		});
	}
	return cells;
}

function formatCellValue(cell: XLSX.CellObject | undefined): string {
	if (!cell) return "";
	if (typeof cell.w === "string") return cell.w;
	if (cell.t === "d" && cell.v instanceof Date) return cell.v.toLocaleDateString();
	if (cell.v == null) return "";
	return String(cell.v);
}

function createCellTitle(cell: XLSX.CellObject | undefined, value: string): string {
	if (cell && typeof cell.f === "string" && cell.f.length > 0) {
		return `${value}\n=${cell.f}`;
	}
	return value;
}

function parseMerges(worksheet: XLSX.WorkSheet): SheetMerge[] {
	return (worksheet["!merges"] ?? []).map((range) => ({
		startRow: range.s.r,
		endRow: range.e.r,
		startColumn: range.s.c,
		endColumn: range.e.c,
	}));
}

function parseRowHeights(worksheet: XLSX.WorkSheet): Map<number, number> {
	const heights = new Map<number, number>();
	worksheet["!rows"]?.forEach((row, index) => {
		if (!row) return;
		if (row.hidden) heights.set(index, 0);
		else if (typeof row.hpt === "number" && Number.isFinite(row.hpt))
			heights.set(index, Math.max(0, Math.min(4096, (row.hpt * 4) / 3)));
		else if (typeof row.hpx === "number" && Number.isFinite(row.hpx))
			heights.set(index, Math.max(0, Math.min(4096, row.hpx)));
	});
	return heights;
}

function parseColumnWidths(worksheet: XLSX.WorkSheet): Map<number, number> {
	const widths = new Map<number, number>();
	worksheet["!cols"]?.forEach((column, index) => {
		if (!column) return;
		if (column.hidden) {
			widths.set(index, 0);
			return;
		}
		const width = column.wpx ?? (typeof column.wch === "number" ? Math.round(column.wch * 8) : undefined);
		if (typeof width === "number" && Number.isFinite(width)) widths.set(index, Math.min(4096, Math.max(1, width)));
	});
	return widths;
}

function findMerge(merges: SheetMerge[], row: number, column: number): SheetMerge | undefined {
	return merges.find(
		(merge) =>
			row >= merge.startRow && row <= merge.endRow && column >= merge.startColumn && column <= merge.endColumn,
	);
}

function isMergeOrigin(merge: SheetMerge, row: number, column: number): boolean {
	return merge.startRow === row && merge.startColumn === column;
}

export function getRowHeight(sheet: SheetModel, row: number): number {
	return sheet.rowHeights.get(row) ?? sheet.defaultRowHeight ?? DEFAULT_ROW_HEIGHT;
}

export function getColumnWidth(sheet: SheetModel, column: number): number {
	return sheet.columnWidths.get(column) ?? sheet.defaultColumnWidth ?? DEFAULT_COLUMN_WIDTH;
}

function decodeDelimitedText(bytes: ArrayBuffer): string {
	const data = new Uint8Array(bytes);
	if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
	if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch {
		return new TextDecoder("gb18030").decode(data);
	}
}
