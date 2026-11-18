import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Use the settings catalogue even if both the preview and the packaged PNG went missing. */
export function checkAppIconResources(desktopRoot, buildRoot, platforms) {
	const catalog = JSON.parse(readFileSync(join(desktopRoot, "src/shared/app-icon-catalog.json"), "utf8"));
	const previews = join(desktopRoot, "src/renderer/domains/settings/assets/app-icons");
	const suffixes = new Set(platforms.map((platform) => (platform === "darwin" ? "-mac.png" : ".png")));
	const problems = [];
	if (!Object.hasOwn(catalog, "default")) problems.push("app icon catalogue is missing default");
	for (const [id, preview] of Object.entries(catalog)) {
		if (!/^[a-z][a-z0-9-]*$/.test(id) || preview !== `${id}.png`) {
			problems.push(`invalid app icon catalogue entry: ${id}`);
			continue;
		}
		const paths = [join(previews, preview)];
		if (id !== "default") for (const suffix of suffixes) paths.push(join(buildRoot, "app-icons", id + suffix));
		for (const path of paths) {
			const file = statSync(path, { throwIfNoEntry: false });
			if (!file?.isFile() || !file.size) problems.push(`missing or empty app icon: ${path}`);
		}
	}
	return problems;
}
