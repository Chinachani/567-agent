import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { app } from "electron";
import { browserExtensionCatalog as catalog, readBundledExtension } from "./extension-bundle.js";

const preparations = new Map<string, Promise<string>>();

async function regularDirectory(directory: string): Promise<void> {
	try {
		await mkdir(directory);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
	}
	if (!(await lstat(directory)).isDirectory()) throw new Error("Invalid browser extension directory");
}

async function verifyPrepared(directory: string, files: Map<string, Buffer>): Promise<void> {
	const remaining = new Set(files.keys());
	const walk = async (relative: string): Promise<void> => {
		if (!(await lstat(join(directory, relative))).isDirectory()) throw new Error("Invalid extension directory");
		for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
			const name = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(name);
			else if (
				!entry.isFile() ||
				!remaining.delete(name) ||
				!(await readFile(join(directory, name))).equals(files.get(name)!)
			) {
				throw new Error("Prepared browser extension was modified");
			}
		}
	};
	await walk("");
	if (remaining.size) throw new Error("Prepared browser extension is incomplete");
}

async function prepare(source: string, home: string): Promise<string> {
	const files = readBundledExtension(await readFile(join(source, catalog.file)));
	for (const [name, digest] of Object.entries(catalog.files)) {
		const contents = await readFile(join(source, name));
		if (createHash("sha256").update(contents).digest("hex") !== digest)
			throw new Error("Extension notice checksum mismatch");
		files.set(name, contents);
	}
	// This is a user-loaded installation, not disposable cache or an app-version resource path.
	await mkdir(home, { recursive: true });
	const base = join(home, "browser-extensions");
	await regularDirectory(base);
	const parent = join(base, "playwright");
	await regularDirectory(parent);
	const destination = join(parent, `${catalog.version}-${catalog.sha256.slice(0, 12)}`);
	try {
		await lstat(destination);
		await verifyPrepared(destination, files);
		return destination;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		// Missing files inside an existing installation must not make it an overwrite candidate.
		const exists = await lstat(destination).then(
			() => true,
			() => false,
		);
		if (exists) throw new Error("Prepared browser extension is incomplete");
	}
	const temporary = await mkdtemp(join(parent, ".prepare-"));
	try {
		for (const [name, contents] of files) {
			const file = join(temporary, name);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, contents, { flag: "wx" });
		}
		try {
			await rename(temporary, destination);
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code))
				)
			) {
				throw error;
			}
		}
		await verifyPrepared(destination, files);
		return destination;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export function prepareBundledExtension(
	source = app.isPackaged
		? join(process.resourcesPath, "browser-extension")
		: join(process.cwd(), "resources", "browser-extension"),
	home = getAgent567HomePath(),
): Promise<string> {
	const key = `${source}\0${home}`;
	const existing = preparations.get(key);
	if (existing) return existing;
	const pending = prepare(source, home).finally(() => preparations.delete(key));
	preparations.set(key, pending);
	return pending;
}
