import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const metadataPattern = /^[a-z0-9_-]+-linux(?:-[a-z0-9_-]+)?\.ya?ml$/i;
const extensionByTarget = { appimage: ".appimage", deb: ".deb", rpm: ".rpm" };

async function snapshot(releaseDir) {
	const files = new Map();
	for (const name of await readdir(releaseDir).catch(() => [])) {
		const info = await stat(join(releaseDir, name));
		if (info.isFile()) files.set(name, `${info.mtimeMs}:${info.ctimeMs}:${info.size}`);
	}
	return files;
}

export function mergeLinuxDocuments(documents) {
	if (documents.length === 0) throw new Error("No Linux update metadata to merge");
	const version = documents[0].version;
	const files = new Map();
	for (const document of documents) {
		if (document.version !== version) throw new Error("Linux update metadata version mismatch");
		for (const file of document.files) {
			const previous = files.get(file.url);
			if (previous && (previous.sha512 !== file.sha512 || previous.size !== file.size)) {
				throw new Error(`Conflicting Linux update artifact: ${file.url}`);
			}
			files.set(file.url, file);
		}
	}
	const rank = (file) => file.url.toLowerCase().endsWith(".appimage") ? 0 : 1;
	const mergedFiles = [...files.values()].sort((a, b) => rank(a) - rank(b));
	return { ...documents[0], files: mergedFiles, path: mergedFiles[0].url, sha512: mergedFiles[0].sha512 };
}

// A separate builder invocation per format prevents FPM targets from overwriting
// each other's package-type marker. Capture and merge metadata before publishing.
export async function buildLinuxTargets({ targets, releaseDir, run, publish }) {
	const before = await snapshot(releaseDir);
	const documentsByName = new Map();
	for (const target of targets) {
		const extension = extensionByTarget[target.toLowerCase()];
		if (!extension) {
			await run([target]);
			continue;
		}
		for (const name of (await snapshot(releaseDir)).keys()) {
			if (metadataPattern.test(name)) await rm(join(releaseDir, name));
		}
		await run([target]);
		let found = false;
		for (const name of (await snapshot(releaseDir)).keys()) {
			if (!metadataPattern.test(name)) continue;
			const document = parse(await readFile(join(releaseDir, name), "utf8"));
			if (!document?.version || !Array.isArray(document.files)) throw new Error(`Invalid Linux metadata: ${name}`);
			const files = document.files.filter((file) => typeof file.url === "string" && file.url.toLowerCase().endsWith(extension));
			if (!files.length) continue;
			found = true;
			const documents = documentsByName.get(name) ?? [];
			documents.push({ ...document, files });
			documentsByName.set(name, documents);
		}
		if (!found) throw new Error(`Missing Linux update metadata for ${target}`);
	}
	for (const [name, documents] of documentsByName) {
		await writeFile(join(releaseDir, name), stringify(mergeLinuxDocuments(documents)));
	}
	const after = await snapshot(releaseDir);
	const artifacts = [...after.keys()].filter((name) =>
		after.get(name) !== before.get(name) &&
		(metadataPattern.test(name) || /\.(?:appimage|deb|rpm|tar\.(?:gz|xz|bz2)|blockmap|zip)$/i.test(name)),
	).map((name) => join(releaseDir, name));
	if (publish) await publish(artifacts);
	return artifacts;
}
