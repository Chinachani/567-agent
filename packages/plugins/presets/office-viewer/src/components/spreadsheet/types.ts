import type { CSSProperties } from "react";

export interface SheetCell {
	value: string;
	title: string;
	colSpan: number;
	rowSpan: number;
	style?: CSSProperties;
}

export interface SheetMerge {
	startRow: number;
	endRow: number;
	startColumn: number;
	endColumn: number;
}

export interface SheetModel {
	name: string;
	cells: Map<string, SheetCell>;
	merges: SheetMerge[];
	rowHeights: Map<number, number>;
	columnWidths: Map<number, number>;
	rowCount: number;
	columnCount: number;
	defaultStyle?: CSSProperties;
	defaultRowHeight?: number;
	defaultColumnWidth?: number;
	rowStyles?: Map<number, CSSProperties>;
	columnStyles?: Array<{ first: number; last: number; style: CSSProperties }>;
	appearance: "styles" | "values" | "plain";
}

export interface SheetViewport {
	width: number;
	height: number;
	top: number;
	left: number;
}

export interface VisibleRange {
	startRow: number;
	endRow: number;
	startColumn: number;
	endColumn: number;
}
