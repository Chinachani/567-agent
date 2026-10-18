import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export async function readInnoLog(logPath) {
	return readFile(logPath).then(
		(bytes) =>
			bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
				? bytes.subarray(2).toString("utf16le")
				: bytes.toString("utf8"),
		(error) => `Unable to read installer log: ${error.message}`,
	);
}

export async function runInnoInstaller({ installerPath, args, logPath, timeoutMs = 300_000 }) {
	return new Promise((resolve, reject) => {
		const child = spawn(installerPath, [...args, `/LOG=${logPath}`], {
			stdio: "ignore",
			windowsHide: true,
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			// The bootstrap EXE owns a second setup process; killing only its parent
			// leaves an error dialog alive and can race the next verification case.
			execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => {
				if (child.exitCode === null) child.kill();
			});
		}, timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", async (code) => {
			clearTimeout(timer);
			if (!timedOut && code === 0) return resolve();
			const log = await readInnoLog(logPath);
			reject(
				new Error(
					`Inno Setup ${timedOut ? `timed out after ${timeoutMs}ms` : `exited with code ${code ?? "unknown"}`}; log follows:\n${log.slice(-12000)}`,
				),
			);
		});
	});
}
