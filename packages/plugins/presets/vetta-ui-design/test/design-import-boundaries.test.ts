import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { expect, it, vi } from "vitest";
import { parsePackagedVetd, importPackagedVetd } from "../src/export/import-design";
import { readDesignArchive } from "../src/shared/archive-paths";

it.each([
	"../existing.txt",
	"/absolute.txt",
	"C:/file",
	"a\\..\\file",
	"a//file",
	"./file",
	"a/../file",
	"nul.txt",
	"a. /file",
])("rejects unsafe design path %s before any write", async (path) => {
	const write = vi.fn();
	const archive = zipSync({ "manifest.json": strToU8("{}"), [`design/${path}`]: strToU8("bad") });
	expect(() => parsePackagedVetd(archive)).toThrow();
	await expect(
		importPackagedVetd(
			{ fs: { writeFile: write } } as never,
			{ manifestJson: "{}", snapshotHtml: null, designFiles: new Map([[path, strToU8("bad")]]), historyZip: null },
			"/target",
			"test.567design",
		),
	).rejects.toThrow();
	expect(write).not.toHaveBeenCalled();
});

it("rejects case and file/directory collisions and validates embedded history before writing", async () => {
	for (const entries of [
		{ "design/A.tsx": strToU8("one"), "design/a.tsx": strToU8("two") },
		{ "design/a": strToU8("file"), "design/a/b": strToU8("child") },
	]) {
		expect(() => readDesignArchive(zipSync(entries))).toThrow(/collision|duplicate/);
	}
	const write = vi.fn();
	await expect(
		importPackagedVetd(
			{ fs: { writeFile: write } } as never,
			{
				manifestJson: "{}",
				snapshotHtml: null,
				designFiles: new Map([["frames/a.tsx", strToU8("safe")]]),
				historyZip: zipSync({ "../existing.txt": strToU8("bad") }),
			},
			"/target",
			"test.567design",
		),
	).rejects.toThrow();
	expect(write).not.toHaveBeenCalled();
});

it("imports into a new bundle, leaves a sibling intact and chooses a new name on a second import", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent567-design-import-"));
	try {
		await writeFile(join(root, "existing.txt"), "USER ORIGINAL");
		const fs = {
			stat: async (path: string) =>
				stat(path).then(
					(value) => ({ size: value.size }),
					() => null,
				),
			writeFile: async (path: string, data: string, encoding?: string) => {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, encoding === "base64" ? Buffer.from(data, "base64") : data);
			},
		};
		const packaged = parsePackagedVetd(
			zipSync({
				"manifest.json": strToU8('{"type":"vetta-design","frames":[]}'),
				"design/frames/a.tsx": strToU8("safe source"),
			}),
		);
		const first = await importPackagedVetd({ fs } as never, packaged, root, "demo.567design");
		const second = await importPackagedVetd({ fs } as never, packaged, root, "demo.567design");
		expect(first).not.toBe(second);
		expect(await readFile(join(first, "frames/a.tsx"), "utf8")).toBe("safe source");
		expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("USER ORIGINAL");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
