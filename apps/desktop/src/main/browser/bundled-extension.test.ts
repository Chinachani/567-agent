import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { stageBrowserExtension } from "../../../scripts/stage-browser-extension.mjs";
import { prepareBundledExtension } from "./bundled-extension";
import { browserExtensionCatalog as catalog, readBundledExtension } from "./extension-bundle";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("@567agent/action-rpc", () => ({
	getAgent567HomePath: () => {
		throw new Error("No real user directory");
	},
}));
const source = fileURLToPath(new URL("../../../resources/browser-extension", import.meta.url));
const temporary: string[] = [];
async function directory(): Promise<string> {
	const value = await mkdtemp(path.join(tmpdir(), "agent567-browser-bundle-"));
	temporary.push(value);
	return value;
}
afterEach(async () => {
	await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("stages the signed official package and prepares a stable, reusable installation without a network or browser profile", async () => {
	const stage = await directory();
	const packaged = await stageBrowserExtension(source, stage);
	const home = await directory();
	const [first, concurrent] = await Promise.all([
		prepareBundledExtension(packaged, home),
		prepareBundledExtension(packaged, home),
	]);
	expect(first).toBe(concurrent);
	expect(first).toBe(
		path.join(home, "browser-extensions", "playwright", `${catalog.version}-${catalog.sha256.slice(0, 12)}`),
	);
	const files = readBundledExtension(await readFile(path.join(source, catalog.file)));
	for (const [name, bytes] of files) expect(await readFile(path.join(first, name))).toEqual(bytes);
	const manifest = JSON.parse(await readFile(path.join(first, "manifest.json"), "utf8"));
	expect(manifest.version).toBe("0.4.0");
	expect(manifest.permissions).toEqual(["debugger", "activeTab", "tabs", "tabGroups"]);
	const id = createHash("sha256")
		.update(Buffer.from(manifest.key, "base64"))
		.digest("hex")
		.slice(0, 32)
		.replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + Number.parseInt(character, 16)));
	expect(id).toBe("mmlmfjhmonkocbjadbfplnigmagldckm");
	expect(await readdir(first)).not.toContain("_metadata");
	expect(await readFile(path.join(first, "LICENSE"), "utf8")).toContain("Apache License");
	expect(await readFile(path.join(first, "LICENSE-react"), "utf8")).toContain("MIT License");
	const before = await lstat(path.join(first, "manifest.json"));
	expect(await prepareBundledExtension(packaged, home)).toBe(first);
	expect((await lstat(path.join(first, "manifest.json"))).mtimeMs).toBe(before.mtimeMs);
	expect(await readdir(home)).toEqual(["browser-extensions"]);
	expect(await readdir(path.dirname(first))).toEqual([path.basename(first)]);
});

it("rejects corrupted vendor files both before packaging and before creating a user installation", async () => {
	const copied = await directory();
	await cp(source, copied, { recursive: true });
	const bytes = await readFile(path.join(copied, catalog.file));
	bytes[bytes.length - 1] ^= 1;
	await writeFile(path.join(copied, catalog.file), bytes);
	const home = await directory();
	await expect(stageBrowserExtension(copied, await directory())).rejects.toThrow(/checksum/);
	await expect(prepareBundledExtension(copied, home)).rejects.toThrow(/checksum/);
	expect(await readdir(home)).toEqual([]);
});

it.each(["changed", "missing", "additional"])(
	"preserves a %s existing installation instead of overwriting it",
	async (kind) => {
		const home = await directory();
		const target = await prepareBundledExtension(source, home);
		const manifest = path.join(target, "manifest.json");
		if (kind === "changed") await writeFile(manifest, "user change");
		if (kind === "missing") await rm(manifest);
		if (kind === "additional") await writeFile(path.join(target, "user.js"), "user file");
		await expect(prepareBundledExtension(source, home)).rejects.toThrow(/modified|incomplete/);
		if (kind === "changed") expect(await readFile(manifest, "utf8")).toBe("user change");
		if (kind === "missing") await expect(lstat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
		if (kind === "additional") expect(await readFile(path.join(target, "user.js"), "utf8")).toBe("user file");
	},
);

it("refuses a linked installation parent without writing into its target", async () => {
	const home = await directory();
	const other = await directory();
	await symlink(other, path.join(home, "browser-extensions"), process.platform === "win32" ? "junction" : "dir");
	await expect(prepareBundledExtension(source, home)).rejects.toThrow(/directory/);
	expect(await readdir(other)).toEqual([]);
});
