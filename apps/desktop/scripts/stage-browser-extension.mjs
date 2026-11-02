import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const BROWSER_EXTENSION_RESOURCE = {
	from: "browser-extension",
	to: "browser-extension",
	filter: ["**/*"],
};

/** No network dependency during packaging; an incomplete vendor source fails the build. */
export async function stageBrowserExtension(source, stage) {
	const catalog = JSON.parse(await readFile(join(source, "catalog.json"), "utf8"));
	const expected = { [catalog.file]: catalog.sha256, ...catalog.files };
	const files = await Promise.all(Object.entries(expected).map(async ([name, digest]) => {
		if (!/^[\w.-]+$/.test(name)) throw new Error("Invalid browser extension resource name");
		const contents = await readFile(join(source, name));
		if (createHash("sha256").update(contents).digest("hex") !== digest) {
			throw new Error(`Browser extension resource checksum mismatch: ${name}`);
		}
		return name;
	}));
	const target = join(stage, BROWSER_EXTENSION_RESOURCE.to);
	await mkdir(target, { recursive: true });
	for (const name of [...files, "catalog.json", "README.md"]) {
		await copyFile(join(source, name), join(target, name));
	}
	return target;
}
