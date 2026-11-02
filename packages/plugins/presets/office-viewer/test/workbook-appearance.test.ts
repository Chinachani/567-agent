import { describe, expect, it } from "vitest";
import { readWorkbookAppearance } from "../src/components/spreadsheet/workbookAppearance";

function fixture(styleTarget = "../styles/cells.xml", mode = "") {
	const files: Record<string, { content: Uint8Array }> = {};
	const add = (path: string, xml: string) => {
		files[path] = { content: new TextEncoder().encode(xml) };
	};
	add(
		"_rels/.rels",
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="parts/book.xml"/></Relationships>',
	);
	add(
		"parts/book.xml",
		'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Custom" r:id="sheet"/></sheets></workbook>',
	);
	add(
		"parts/_rels/book.xml.rels",
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="${styleTarget}" ${mode}/><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../worksheets/custom.xml"/></Relationships>`,
	);
	add(
		"styles/cells.xml",
		'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts><font><b val="0"/><sz val="11"/><color rgb="112233"/></font></fonts><fills><fill><patternFill patternType="solid"><fgColor rgb="ABCDEF"/></patternFill></fill></fills><borders><border/></borders><cellXfs><xf fontId="0" fillId="0" borderId="0"><alignment wrapText="true"/></xf></cellXfs></styleSheet>',
	);
	add(
		"worksheets/custom.xml",
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="18" defaultColWidth="12"/><cols><col min="1" max="2" style="0"/></cols><sheetData><row r="1" s="0"><c r="A1" s="0"/></row></sheetData></worksheet>',
	);
	return { files };
}

describe("OOXML appearance boundary", () => {
	it("follows package relationships and keeps row, column and explicit cell styles", () => {
		const result = readWorkbookAppearance(fixture()).get("Custom");
		expect(result?.cells.get("A1")).toMatchObject({
			color: "#112233",
			backgroundColor: "#ABCDEF",
			fontWeight: 400,
			whiteSpace: "pre-wrap",
		});
		expect(result?.rows.get(0)).toBeTruthy();
		expect(result?.columns[0]).toMatchObject({ first: 0, last: 1 });
		expect(result?.defaultRowHeight).toBe(24);
	});

	it("does not follow external relationships or expand XML entities", () => {
		expect(readWorkbookAppearance(fixture("https://example.invalid/styles.xml", 'TargetMode="External"')).size).toBe(
			0,
		);
		const workbook = fixture();
		workbook.files["styles/cells.xml"].content = new TextEncoder().encode(
			'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]><styleSheet>&x;</styleSheet>',
		);
		expect(readWorkbookAppearance(workbook).size).toBe(0);
	});

	it("declines broken metadata while leaving the data reader usable", () => {
		expect(readWorkbookAppearance({})).toEqual(new Map());
		const workbook = fixture();
		workbook.files["styles/cells.xml"].content = new TextEncoder().encode("<broken>");
		expect(readWorkbookAppearance(workbook).size).toBe(0);
	});
});
