import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { windowsSupplementalArtifactNames } from "./windows-packaging-contract.mjs";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");

async function assertNonEmptyFile(filePath) {
	const info = await stat(filePath);
	if (!info.isFile() || info.size === 0) {
		throw new Error(`[verify-windows-packages] expected a non-empty file: ${filePath}`);
	}
}

async function findFiles(root, fileName, relativeRoot = "") {
	const matches = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			matches.push(...(await findFiles(root, fileName, relativePath)));
		} else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
			matches.push(join(root, relativePath));
		}
	}
	return matches;
}

async function isValidLayoutRoot(root, expectedVersion) {
	try {
		const manifest = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
		if (manifest?.version !== expectedVersion) return false;
		await Promise.all([
			assertNonEmptyFile(join(root, "567-Agent.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "567-Agent.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "resources", "app.asar")),
		]);
		return true;
	} catch {
		return false;
	}
}

export async function verifyExtractedWindowsLayout(root, expectedVersion) {
	const manifests = await findFiles(root, "current.json");
	const validRoots = [];
	for (const manifestPath of manifests) {
		const candidateRoot = dirname(manifestPath);
		if (await isValidLayoutRoot(candidateRoot, expectedVersion)) validRoots.push(candidateRoot);
	}
	if (validRoots.length !== 1) {
		throw new Error(
			`[verify-windows-packages] expected one complete ${expectedVersion} layout in ${root}, found ${validRoots.length}`,
		);
	}
	return validRoots[0];
}

export async function readExpectedWindowsVersion(releaseDir) {
	const document = parse(await readFile(join(releaseDir, "latest.yml"), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error("[verify-windows-packages] latest.yml has an invalid version");
	}
	return document.version;
}

async function extractZip(packagePath, destination) {
	await execFileAsync("tar.exe", ["-xf", packagePath, "-C", destination]);
}

async function installMsiForVerification(packagePath, destination, logPath) {
	try {
		await execFileAsync("msiexec.exe", [
			"/i",
			packagePath,
			"/qn",
			"/norestart",
			"ALLUSERS=1",
			`INSTALLDIR=${destination}`,
			"/L*V",
			logPath,
		], { timeout: 180_000 });
	} catch (error) {
		const log = await readMsiLog(logPath);
		throw new Error(
			`[verify-windows-packages] MSI installation failed. msiexec log tail:\n${log.split(/\r?\n/).slice(-100).join("\n")}`,
			{ cause: error },
		);
	}
}

async function readMsiLog(logPath) {
	return readFile(logPath)
		.then((contents) =>
			contents.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
				? contents.subarray(2).toString("utf16le")
				: contents.toString("utf8"),
		)
		.catch(() => "");
}

async function findInstalledMsiProduct() {
	const script = [
		"$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
		"$product = Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq '567 Agent' } | Sort-Object DisplayVersion -Descending | Select-Object -First 1",
		"if ($product) { [PSCustomObject]@{ ProductCode = $product.PSChildName; InstallLocation = $product.InstallLocation } | ConvertTo-Json -Compress }",
	].join("; ");
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
	const output = stdout.trim();
	if (!output) return undefined;
	const product = JSON.parse(output);
	return {
		productCode: typeof product.ProductCode === "string" ? product.ProductCode : "",
		installLocation: typeof product.InstallLocation === "string" ? product.InstallLocation.trim() : "",
	};
}

async function uninstallMsiProduct(productCode, logPath) {
	if (!/^\{[0-9a-f-]{36}\}$/i.test(productCode)) return;
	try {
		await execFileAsync("msiexec.exe", ["/x", productCode, "/qn", "/norestart", "/L*V", logPath], {
			timeout: 180_000,
		});
	} catch (error) {
		console.warn(`[verify-windows-packages] could not remove temporary MSI installation: ${error.message}`);
	}
}

export async function verifyWindowsPackages({ releaseDir = defaultReleaseDir } = {}) {
	if (process.platform !== "win32") {
		throw new Error("[verify-windows-packages] native Windows package verification must run on Windows");
	}
	const expectedVersion = await readExpectedWindowsVersion(releaseDir);
	const [msiFileName, zipFileName] = windowsSupplementalArtifactNames(expectedVersion);
	const msiPath = join(releaseDir, msiFileName);
	const zipPath = join(releaseDir, zipFileName);
	await Promise.all([assertNonEmptyFile(msiPath), assertNonEmptyFile(zipPath)]);

	const extractionRoot = await mkdtemp(join(tmpdir(), "vetta-windows-packages-"));
	const msiRoot = join(extractionRoot, "msi");
	const zipRoot = join(extractionRoot, "zip");
	const msiLogPath = join(extractionRoot, "msiexec-install.log");
	const uninstallLogPath = join(extractionRoot, "msiexec-uninstall.log");
	await Promise.all([mkdir(msiRoot, { recursive: true }), mkdir(zipRoot, { recursive: true })]);
	let installedProduct;
	try {
		const preexistingProduct = await findInstalledMsiProduct();
		if (preexistingProduct) {
			throw new Error(
				`[verify-windows-packages] refusing to replace an existing 567 Agent MSI installation at ${preexistingProduct.installLocation || "an unknown path"}`,
			);
		}
		await installMsiForVerification(msiPath, msiRoot, msiLogPath);
		installedProduct = await findInstalledMsiProduct();
		const installRoots = [installedProduct?.installLocation, msiRoot].filter(Boolean);
		let verifiedMsiRoot;
		let lastError;
		for (const installRoot of [...new Set(installRoots)]) {
			try {
				verifiedMsiRoot = await verifyExtractedWindowsLayout(installRoot, expectedVersion);
				break;
			} catch (error) {
				lastError = error;
			}
		}
		if (!verifiedMsiRoot) {
			const log = await readMsiLog(msiLogPath);
			throw new Error(
				`[verify-windows-packages] MSI installed, but its registered install location has no valid versioned payload (${installedProduct?.installLocation || "not registered"}). msiexec log tail:\n${log.split(/\r?\n/).slice(-80).join("\n")}`,
				{ cause: lastError },
			);
		}
		await extractZip(zipPath, zipRoot);
		const verifiedZipRoot = await verifyExtractedWindowsLayout(zipRoot, expectedVersion);
		console.info(`[verify-windows-packages] MSI and portable ZIP verified: ${expectedVersion}`);
		return { version: expectedVersion, msiPath, zipPath, msiRoot: verifiedMsiRoot, zipRoot: verifiedZipRoot };
	} finally {
		installedProduct ??= await findInstalledMsiProduct().catch(() => undefined);
		if (installedProduct?.productCode) {
			await uninstallMsiProduct(installedProduct.productCode, uninstallLogPath);
		}
		await rm(extractionRoot, { recursive: true, force: true });
	}
}

export async function main() {
	await verifyWindowsPackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
