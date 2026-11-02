import type { CSSProperties, JSX } from "react";
import { createCellKey } from "./cellKeys";
import { getColumnWidth, getRowHeight } from "./parseWorkbook";
import { getColumnLeft, getRowTop } from "./sheetGeometry";
import type { SheetModel, VisibleRange } from "./types";

export function VisibleCells({ sheet, visible }: { sheet: SheetModel; visible: VisibleRange }): JSX.Element {
	const intersecting = sheet.merges.filter(
		(merge) =>
			merge.startRow < visible.endRow &&
			merge.endRow >= visible.startRow &&
			merge.startColumn < visible.endColumn &&
			merge.endColumn >= visible.startColumn,
	);
	const positions = new Map<string, { row: number; column: number }>();
	// The origin can be outside the virtual viewport while its merged body remains visible.
	for (const merge of intersecting)
		positions.set(createCellKey(merge.startRow, merge.startColumn), {
			row: merge.startRow,
			column: merge.startColumn,
		});
	for (let row = visible.startRow; row < visible.endRow; row++) {
		for (let column = visible.startColumn; column < visible.endColumn; column++) {
			if (getRowHeight(sheet, row) === 0 || getColumnWidth(sheet, column) === 0) continue;
			if (
				intersecting.some(
					(merge) =>
						row >= merge.startRow &&
						row <= merge.endRow &&
						column >= merge.startColumn &&
						column <= merge.endColumn,
				)
			)
				continue;
			positions.set(createCellKey(row, column), { row, column });
		}
	}
	return (
		<>
			{[...positions].map(([key, { row, column }]) => {
				const cell = sheet.cells.get(key);
				const columnStyle = sheet.columnStyles?.find(
					(style) => column >= style.first && column <= style.last,
				)?.style;
				const style: CSSProperties = {
					position: "absolute",
					display: "flex",
					flexDirection: "column",
					justifyContent: "flex-end",
					overflow: "hidden",
					whiteSpace: "pre",
					overflowWrap: "anywhere",
					boxSizing: "border-box",
					borderRight: "1px solid #e5e7eb",
					borderBottom: "1px solid #e5e7eb",
					backgroundColor: "#FFFFFF",
					color: "#000000",
					fontSize: "12px",
					padding: "0 4px",
					lineHeight: 1.2,
					...sheet.defaultStyle,
					...columnStyle,
					...sheet.rowStyles?.get(row),
					...cell?.style,
					left: getColumnLeft(sheet, column),
					top: getRowTop(sheet, row),
					width: getColumnLeft(sheet, column + (cell?.colSpan ?? 1)) - getColumnLeft(sheet, column),
					height: getRowTop(sheet, row + (cell?.rowSpan ?? 1)) - getRowTop(sheet, row),
				};
				return (
					<div key={key} title={cell?.title ?? ""} style={style}>
						<div className="min-w-0">{cell?.value ?? ""}</div>
					</div>
				);
			})}
		</>
	);
}
