import type { CSSProperties } from "react";

export interface WorksheetAppearance {
	cells: Map<string, CSSProperties>;
	rows: Map<number, CSSProperties>;
	columns: Array<{ first: number; last: number; style: CSSProperties }>;
	defaultStyle: CSSProperties;
	defaultRowHeight: number;
	defaultColumnWidth: number;
}

const DEFAULT_THEME = [
	"FFFFFF",
	"000000",
	"EEECE1",
	"1F497D",
	"4F81BD",
	"C0504D",
	"9BBB59",
	"8064A2",
	"4BACC6",
	"F79646",
];
const INDEXED_COLORS = [
	"000000",
	"FFFFFF",
	"FF0000",
	"00FF00",
	"0000FF",
	"FFFF00",
	"FF00FF",
	"00FFFF",
	"000000",
	"FFFFFF",
	"FF0000",
	"00FF00",
	"0000FF",
	"FFFF00",
	"FF00FF",
	"00FFFF",
	"800000",
	"008000",
	"000080",
	"808000",
	"800080",
	"008080",
	"C0C0C0",
	"808080",
	"9999FF",
	"993366",
	"FFFFCC",
	"CCFFFF",
	"660066",
	"FF8080",
	"0066CC",
	"CCCCFF",
	"000080",
	"FF00FF",
	"FFFF00",
	"00FFFF",
	"800080",
	"800000",
	"008080",
	"0000FF",
	"00CCFF",
	"CCFFFF",
	"CCFFCC",
	"FFFF99",
	"99CCFF",
	"FF99CC",
	"CC99FF",
	"FFCC99",
	"3366FF",
	"33CCCC",
	"99CC00",
	"FFCC00",
	"FF9900",
	"FF6600",
	"666699",
	"969696",
	"003366",
	"339966",
	"003300",
	"333300",
	"993300",
	"993366",
	"333399",
	"333333",
];
const MAX_XML_BYTES = 32 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `bookFiles` is the public SheetJS raw-file option. Do not depend on its private Styles/CellXf objects. */
function xmlFile(files: Record<string, unknown>, path: string): Document | undefined {
	const file = files[path];
	if (!record(file)) return;
	const content = file.content;
	let text: string;
	if (typeof content === "string") text = content;
	else if (ArrayBuffer.isView(content) && content.byteLength <= MAX_XML_BYTES)
		text = new TextDecoder().decode(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
	else return;
	if (text.length > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(text)) return;
	const document = new DOMParser().parseFromString(text, "application/xml");
	return document.getElementsByTagName("parsererror").length ? undefined : document;
}

function elements(parent: Document | Element | undefined, name: string): Element[] {
	return parent ? Array.from(parent.getElementsByTagNameNS("*", name)) : [];
}

function first(parent: Document | Element | undefined, name: string): Element | undefined {
	return elements(parent, name)[0];
}

function numberAttribute(element: Element | undefined, name: string): number | undefined {
	const raw = element?.getAttribute(name);
	if (raw === null || raw === undefined || raw === "") return;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function enabled(element: Element | undefined): boolean {
	return Boolean(element && !["0", "false", "off", "none"].includes(element.getAttribute("val") ?? "1"));
}

function color(element: Element | undefined, theme: readonly string[], indexed: readonly string[]): string | undefined {
	if (!element) return;
	const rgb = element.getAttribute("rgb");
	const themeId = numberAttribute(element, "theme");
	const index = numberAttribute(element, "indexed");
	const value = rgb ?? (themeId !== undefined ? theme[themeId] : index !== undefined ? indexed[index] : undefined);
	if (!value || !/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return;
	const hex = value.slice(-6);
	const tint = Math.max(-1, Math.min(1, numberAttribute(element, "tint") ?? 0));
	if (!tint) return `#${hex}`;
	return `#${[0, 2, 4]
		.map((offset) => {
			const channel = Number.parseInt(hex.slice(offset, offset + 2), 16);
			return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint)
				.toString(16)
				.padStart(2, "0");
		})
		.join("")}`;
}

function border(side: Element | undefined, theme: readonly string[], indexed: readonly string[]): string | undefined {
	const kind = side?.getAttribute("style");
	if (!kind) return;
	const width = kind === "double" || kind === "thick" ? 3 : kind.startsWith("medium") ? 2 : 1;
	const line = kind === "double" ? "double" : /dash/i.test(kind) ? "dashed" : kind === "dotted" ? "dotted" : "solid";
	return `${width}px ${line} ${color(first(side, "color"), theme, indexed) ?? "#000000"}`;
}

function resolvePart(base: string, target: string): string | undefined {
	if (/^[a-z][\w+.-]*:/i.test(target) || target.includes("\\")) return;
	const parts: string[] = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
	for (const part of target.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (!parts.length) return;
			parts.pop();
		} else parts.push(part);
	}
	return parts.join("/");
}

function relationships(files: Record<string, unknown>, owner: string): Map<string, { path: string; type: string }> {
	const slash = owner.lastIndexOf("/");
	const path = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`;
	const result = new Map<string, { path: string; type: string }>();
	for (const relation of elements(xmlFile(files, path), "Relationship")) {
		if (relation.getAttribute("TargetMode") === "External") continue;
		const target = resolvePart(owner, relation.getAttribute("Target") ?? "");
		const id = relation.getAttribute("Id");
		if (target && id) result.set(id, { path: target, type: relation.getAttribute("Type") ?? "" });
	}
	return result;
}

function styleTable(styles: Document, theme: readonly string[]): CSSProperties[] {
	const indexed = elements(first(styles, "indexedColors"), "rgbColor").map(
		(element) => element.getAttribute("rgb") ?? "",
	);
	const palette = indexed.length ? indexed : INDEXED_COLORS;
	const fonts = elements(first(styles, "fonts"), "font");
	const fills = elements(first(styles, "fills"), "fill");
	const borders = elements(first(styles, "borders"), "border");
	const inherited = elements(first(styles, "cellStyleXfs"), "xf");
	return elements(first(styles, "cellXfs"), "xf").map((xf) => {
		const parent = inherited[numberAttribute(xf, "xfId") ?? 0];
		const font = fonts[numberAttribute(xf, "fontId") ?? numberAttribute(parent, "fontId") ?? 0];
		const fill = fills[numberAttribute(xf, "fillId") ?? numberAttribute(parent, "fillId") ?? 0];
		const edges = borders[numberAttribute(xf, "borderId") ?? numberAttribute(parent, "borderId") ?? 0];
		const pattern = first(fill, "patternFill");
		const alignment = first(xf, "alignment") ?? first(parent, "alignment");
		const horizontal = alignment?.getAttribute("horizontal");
		const vertical = alignment?.getAttribute("vertical");
		const size = numberAttribute(first(font, "sz"), "val");
		const decorations = [
			enabled(first(font, "u")) ? "underline" : "",
			enabled(first(font, "strike")) ? "line-through" : "",
		].filter(Boolean);
		const style: CSSProperties = {
			fontFamily: first(font, "name")?.getAttribute("val") ?? undefined,
			fontSize: size !== undefined ? `${(Math.max(1, Math.min(409, size)) * 4) / 3}px` : undefined,
			fontWeight: enabled(first(font, "b")) ? 700 : 400,
			fontStyle: enabled(first(font, "i")) ? "italic" : "normal",
			textDecorationLine: decorations.join(" ") || "none",
			color: color(first(font, "color"), theme, palette) ?? "#000000",
			backgroundColor:
				pattern?.getAttribute("patternType") === "solid"
					? (color(first(pattern, "fgColor"), theme, palette) ?? "#FFFFFF")
					: "#FFFFFF",
			textAlign:
				horizontal === "center" || horizontal === "centerContinuous"
					? "center"
					: horizontal === "right"
						? "right"
						: horizontal === "left"
							? "left"
							: horizontal === "justify" || horizontal === "distributed"
								? "justify"
								: undefined,
			justifyContent: vertical === "center" ? "center" : vertical === "top" ? "flex-start" : "flex-end",
			whiteSpace: ["1", "true", "on"].includes(alignment?.getAttribute("wrapText") ?? "") ? "pre-wrap" : "pre",
			borderLeft: border(first(edges, "left"), theme, palette) ?? "none",
			borderRight: border(first(edges, "right"), theme, palette) ?? "1px solid #e5e7eb",
			borderTop: border(first(edges, "top"), theme, palette) ?? "none",
			borderBottom: border(first(edges, "bottom"), theme, palette) ?? "1px solid #e5e7eb",
		};
		for (const key of Object.keys(style) as Array<keyof CSSProperties>)
			if (style[key] === undefined) delete style[key];
		return style;
	});
}

/** Read only presentation metadata. Cell values, formulas and merge ranges remain owned by SheetJS. */
export function readWorkbookAppearance(workbook: unknown): Map<string, WorksheetAppearance> {
	const result = new Map<string, WorksheetAppearance>();
	if (!record(workbook) || !record(workbook.files)) return result;
	const files = workbook.files;
	const rootRelation = elements(xmlFile(files, "_rels/.rels"), "Relationship").find(
		(entry) =>
			entry.getAttribute("Type")?.endsWith("/officeDocument") && entry.getAttribute("TargetMode") !== "External",
	);
	const owner = resolvePart("", rootRelation?.getAttribute("Target") ?? "xl/workbook.xml");
	if (!owner) return result;
	const links = relationships(files, owner);
	const stylePath = [...links.values()].find((link) => link.type.endsWith("/styles"))?.path;
	const styles = stylePath ? xmlFile(files, stylePath) : undefined;
	if (!styles) return result;
	const themePath = [...links.values()].find((link) => link.type.endsWith("/theme"))?.path;
	const scheme = first(themePath ? xmlFile(files, themePath) : undefined, "clrScheme");
	const theme = [...DEFAULT_THEME];
	for (const [index, name] of [
		"lt1",
		"dk1",
		"lt2",
		"dk2",
		"accent1",
		"accent2",
		"accent3",
		"accent4",
		"accent5",
		"accent6",
	].entries()) {
		const slot = first(scheme, name)?.firstElementChild;
		const value = slot?.getAttribute("lastClr") ?? slot?.getAttribute("val");
		if (value && /^[0-9a-f]{6}$/i.test(value)) theme[index] = value;
	}
	const table = styleTable(styles, theme);
	for (const sheet of elements(xmlFile(files, owner), "sheet")) {
		const name = sheet.getAttribute("name");
		const id =
			sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
			sheet.getAttribute("r:id");
		const path = id ? links.get(id)?.path : undefined;
		const document = path ? xmlFile(files, path) : undefined;
		if (!name || !document) continue;
		const sheetFormat = first(document, "sheetFormatPr");
		const appearance: WorksheetAppearance = {
			cells: new Map(),
			rows: new Map(),
			columns: [],
			defaultStyle: table[0] ?? {},
			defaultRowHeight: Math.max(
				0,
				Math.min(4096, ((numberAttribute(sheetFormat, "defaultRowHeight") ?? 15) * 4) / 3),
			),
			defaultColumnWidth: Math.max(
				1,
				Math.min(4096, Math.round((numberAttribute(sheetFormat, "defaultColWidth") ?? 8.43) * 7 + 5)),
			),
		};
		for (const column of elements(document, "col")) {
			const style = table[numberAttribute(column, "style") ?? -1];
			const first = numberAttribute(column, "min");
			const last = numberAttribute(column, "max");
			if (style && first !== undefined && last !== undefined)
				appearance.columns.push({ first: first - 1, last: last - 1, style });
		}
		for (const row of elements(document, "row")) {
			const index = numberAttribute(row, "r");
			const rowStyle = table[numberAttribute(row, "s") ?? -1];
			if (index !== undefined && rowStyle) appearance.rows.set(index - 1, rowStyle);
			for (const cell of elements(row, "c")) {
				const address = cell.getAttribute("r");
				const style = table[numberAttribute(cell, "s") ?? -1];
				if (address && style) appearance.cells.set(address, style);
			}
		}
		result.set(name, appearance);
	}
	return result;
}
