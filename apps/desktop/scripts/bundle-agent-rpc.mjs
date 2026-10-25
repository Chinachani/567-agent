import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Use the desktop composition for Windows too; the generic CLI carries no product signer. */
export function bundleDesktopAgentRpc(outputPath) {
	execFileSync(
		process.platform === "win32" ? "bun.exe" : "bun",
		[
			"build",
			fileURLToPath(new URL("../src/main/cli/agent-rpc-node-entry.ts", import.meta.url)),
			"--target",
			"node",
			"--format",
			"esm",
			"--outfile",
			outputPath,
		],
		{ cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe" },
	);
}
