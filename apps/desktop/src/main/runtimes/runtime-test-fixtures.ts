import { copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Real Node process plus a small npm tree that fails if a required module is lost. */
export async function writeNodeRuntimeFixture(
	root: string,
	windowsLayout = process.platform === "win32",
): Promise<string> {
	const executablePath = windowsLayout ? join(root, "node.exe") : join(root, "bin", "node");
	await mkdir(dirname(executablePath), { recursive: true });
	if (process.platform === "win32") await copyFile(process.execPath, executablePath);
	else await symlink(process.execPath, executablePath);
	const npmDirectory = windowsLayout ? join(root, "node_modules", "npm") : join(root, "lib", "node_modules", "npm");
	await mkdir(join(npmDirectory, "bin"), { recursive: true });
	await writeFile(join(npmDirectory, "package.json"), JSON.stringify({ version: "10.9.2" }));
	await writeFile(join(npmDirectory, "bin", "npm-cli.js"), 'console.log(require("../package.json").version);');
	await writeFile(join(npmDirectory, "bin", "npx-cli.js"), 'require("./npm-cli.js");');
	return executablePath;
}
