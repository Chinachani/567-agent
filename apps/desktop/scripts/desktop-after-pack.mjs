import { rm } from "node:fs/promises";
import { join } from "node:path";
import windowsVersionLayout from "./windows-version-layout.mjs";

export default async function desktopAfterPack(context) {
	if (context.electronPlatformName === "linux") {
		// FPM writes the marker after this hook. A fresh AppImage must have none.
		await rm(join(context.appOutDir, "resources/package-type"), { force: true });
	}
	await windowsVersionLayout(context);
}
