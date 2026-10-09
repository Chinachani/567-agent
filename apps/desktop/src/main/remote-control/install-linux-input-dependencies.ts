import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

const PACKAGE_MANAGERS = [
	{ name: "apt-get", args: ["install", "-y", "libx11-6", "libxtst6"] },
	{ name: "dnf", args: ["install", "-y", "libX11", "libXtst"] },
	{ name: "pacman", args: ["-S", "--needed", "--noconfirm", "libx11", "libxtst"] },
	{ name: "zypper", args: ["--non-interactive", "install", "libX11-6", "libXtst6"] },
] as const;

export async function installLinuxInputDependencies(): Promise<void> {
	if (process.platform !== "linux") throw new Error("Linux input dependencies can only be installed on Linux.");
	const pathEntries = (process.env.PATH ?? "").split(delimiter);
	const pkexecPath = await findExecutable("pkexec", pathEntries);
	if (!pkexecPath) throw new Error("A system authorization prompt is unavailable (pkexec was not found).");

	for (const manager of PACKAGE_MANAGERS) {
		const managerPath = await findExecutable(manager.name, pathEntries);
		if (!managerPath) continue;
		await run(pkexecPath, [managerPath, ...manager.args]);
		return;
	}
	throw new Error("No supported Linux package manager was found (apt, dnf, pacman, or zypper).");
}

async function findExecutable(name: string, pathEntries: readonly string[]): Promise<string | undefined> {
	for (const entry of pathEntries) {
		const candidate = join(entry, name);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue searching PATH.
		}
	}
	return undefined;
}

function run(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], { stdio: "ignore", shell: false });
		child.once("error", (error) =>
			reject(new Error(`Could not start the system package installer: ${error.message}`)),
		);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else
				reject(new Error(`System package installation was cancelled or failed (exit code ${code ?? "unknown"}).`));
		});
	});
}
