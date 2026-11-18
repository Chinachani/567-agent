import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { checkAppIconResources } from "./app-icon-resources.mjs";
import windowsVersionLayout from "./windows-version-layout.mjs";
import { UPDATER_CACHE_DIR_NAME } from "./updater-cache-dir.mjs";

export async function writeAppUpdateConfig(appRootDir, publish, resourcesDirectory = "resources") {
	const publishConfig = Array.isArray(publish) ? publish[0] : publish;
	const configPath = join(appRootDir, resourcesDirectory, "app-update.yml");
	if (!publishConfig || typeof publishConfig !== "object") {
		await rm(configPath, { force: true });
		return;
	}
	await writeFile(
		configPath,
		stringify({ ...publishConfig, updaterCacheDirName: UPDATER_CACHE_DIR_NAME }),
		"utf8",
	);
}

export function getPackedAppRootDir(context) {
	if (context.electronPlatformName !== "darwin") return context.appOutDir;
	const productFilename = context.packager?.appInfo?.productFilename;
	if (!productFilename) throw new Error("Missing productFilename for macOS app-update.yml placement");
	return join(context.appOutDir, `${productFilename}.app`, "Contents");
}

export default async function desktopAfterPack(context) {
	const root = getPackedAppRootDir(context);
	const resources = context.electronPlatformName === "darwin" ? "Resources" : "resources";
	const missing = checkAppIconResources(join(import.meta.dirname, ".."), join(root, resources, "build"), [context.electronPlatformName]);
	if (missing.length) throw new Error(missing.join("\n"));
	await writeAppUpdateConfig(root, context.packager?.config?.publish, resources);
	if (context.electronPlatformName === "linux") {
		// FPM writes the marker after this hook. A fresh AppImage must have none.
		await rm(join(context.appOutDir, "resources/package-type"), { force: true });
	}
	await windowsVersionLayout(context);
}
