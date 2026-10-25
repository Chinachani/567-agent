import { execFileSync } from "node:child_process";
import { win32 } from "node:path";

const QUERY_DATA_ROOT = [
	"$ErrorActionPreference = 'Stop'",
	"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
	"$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\567Agent')",
	"try { $value = if ($key) { $key.GetValue('DataRoot', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }; ConvertTo-Json -Compress -InputObject $value } finally { if ($key) { $key.Dispose() } }",
].join("; ");

export function parseWindowsRegisteredDataRoot(value: unknown): string | null {
	if (value == null || value === "") return null;
	if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f]/.test(value))
		throw new Error("Invalid saved Windows data folder");
	const root = win32.normalize(value.trim());
	if (
		!win32.isAbsolute(root) ||
		(!/^[A-Za-z]:\\/.test(root) && !root.startsWith("\\\\")) ||
		win32.parse(root).root === root ||
		root.startsWith("\\\\?\\") ||
		root.startsWith("\\\\.\\")
	)
		throw new Error("Invalid saved Windows data folder");
	return root;
}

/** Read once at process bootstrap; failures must not silently select an empty default profile. */
export function readWindowsRegisteredDataRoot(): string | null {
	if (process.platform !== "win32") return null;
	try {
		const output = execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(QUERY_DATA_ROOT, "utf16le").toString("base64"),
			],
			{ encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 32768 },
		);
		return parseWindowsRegisteredDataRoot(JSON.parse(output.trim().replace(/^\uFEFF/, "") || "null"));
	} catch (cause) {
		throw new Error(
			"Unable to read the saved 567 Agent data folder; retry or repair the installation before opening another profile",
			{ cause },
		);
	}
}
