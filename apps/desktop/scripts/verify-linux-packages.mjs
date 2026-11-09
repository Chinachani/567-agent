import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { APPORT_POLICY_PATH, verifyLinuxCrashPolicy } from "./linux-crash-policy.mjs";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");
const requiredPayloadPaths = ["/opt/567-agent/567-agent", "/opt/567-agent/resources/package-type", APPORT_POLICY_PATH];

function requireValue(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`[verify-linux-packages] missing ${label}`);
	}
	return value.trim();
}

export function parseDebFields(output) {
	const fields = new Map();
	for (const line of output.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	return {
		name: requireValue(fields.get("Package"), "Debian Package field"),
		version: requireValue(fields.get("Version"), "Debian Version field"),
		arch: requireValue(fields.get("Architecture"), "Debian Architecture field"),
	};
}

export function parseDebContents(output) {
	return output
		.split(/\r?\n/)
		.map((line) => line.match(/\s(\.\/.+?)(?:\s+->\s+.+)?$/)?.[1])
		.filter(Boolean)
		.map((filePath) => filePath.replace(/^\./, ""));
}

export function parseRpmFields(output) {
	const [name, version, arch] = output.split(/\r?\n/).map((value) => value.trim());
	return {
		name: requireValue(name, "RPM name"),
		version: requireValue(version, "RPM version"),
		arch: requireValue(arch, "RPM architecture"),
	};
}

function verifyPayload(format, paths) {
	const pathSet = new Set(paths);
	for (const requiredPath of requiredPayloadPaths) {
		if (!pathSet.has(requiredPath)) {
			throw new Error(`[verify-linux-packages] ${format} package is missing ${requiredPath}`);
		}
	}
	if (!pathSet.has("/usr/share/applications/567-agent.desktop")) {
		throw new Error(`[verify-linux-packages] ${format} package is missing /usr/share/applications/567-agent.desktop`);
	}
	if (
		![...pathSet].some(
			(filePath) => filePath.startsWith("/usr/share/icons/hicolor/") && filePath.endsWith("/apps/567-agent.png"),
		)
	) {
		throw new Error(`[verify-linux-packages] ${format} package has no 567-agent hicolor icon`);
	}
}

function verifyIdentity(format, actual, expected) {
	for (const key of ["name", "version", "arch"]) {
		if (actual[key] !== expected[key]) {
			throw new Error(`[verify-linux-packages] ${format} ${key} ${actual[key]} does not match ${expected[key]}`);
		}
	}
}

export function verifyLinuxPackageInspection({ expectedVersion, deb, rpm }) {
	verifyIdentity("Debian", deb, { name: "567-agent", version: expectedVersion, arch: "amd64" });
	verifyIdentity("RPM", rpm, { name: "567-agent", version: expectedVersion, arch: "x86_64" });
	verifyPayload("Debian", deb.paths);
	verifyPayload("RPM", rpm.paths);
	verifyLinuxCrashPolicy(deb.crashPolicy);
	verifyLinuxCrashPolicy(rpm.crashPolicy);
}

async function findExactlyOnePackage(releaseDir, extension) {
	const files = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
		.map((entry) => entry.name)
		.sort();
	if (files.length !== 1) {
		throw new Error(
			`[verify-linux-packages] expected one ${extension} package in ${releaseDir}, found ${files.length}`,
		);
	}
	return join(releaseDir, files[0]);
}

export async function readExpectedVersion(releaseDir) {
	const metadataFiles = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && /^latest-linux(?:-[a-z0-9_-]+)?\.ya?ml$/i.test(entry.name))
		.map((entry) => entry.name);
	if (metadataFiles.length !== 1) {
		throw new Error(
			`[verify-linux-packages] expected one Linux update manifest in ${releaseDir}, found ${metadataFiles.length}`,
		);
	}
	const document = parse(await readFile(join(releaseDir, metadataFiles[0]), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error(`[verify-linux-packages] ${metadataFiles[0]} has an invalid version`);
	}
	return document.version;
}

// Stream just the policy entry out of each archive; never install a package.
export async function readPackagedCrashPolicy(format, packagePath) {
	const readEntry = (command, args, extractor, extractorArgs) =>
		new Promise((resolveEntry, reject) => {
			const source = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
			const sink = spawn(extractor, extractorArgs, { stdio: ["pipe", "pipe", "pipe"] });
			source.stdout.pipe(sink.stdin);
			let text = "";
			let bytes = 0;
			let sourceCode;
			let sinkCode;
			const fail = (error) => {
				clearTimeout(timer);
				source.kill();
				sink.kill();
				reject(error);
			};
			const timer = setTimeout(() => fail(new Error("Reading packaged Linux Apport policy timed out")), 120_000);
			const finish = () => {
				if (sourceCode === undefined || sinkCode === undefined) return;
				clearTimeout(timer);
				if (sourceCode !== 0 || sinkCode !== 0) reject(new Error("Could not read packaged Linux Apport policy"));
				else resolveEntry(text);
			};
			source.on("error", fail);
			sink.on("error", fail);
			sink.stdin.on("error", fail);
			source.stderr.resume();
			sink.stderr.resume();
			sink.stdout.setEncoding("utf8");
			sink.stdout.on("data", (chunk) => {
				bytes += Buffer.byteLength(chunk);
				if (bytes > 4096) fail(new Error("Packaged Linux Apport policy exceeds size limit"));
				else text += chunk;
			});
			source.on("close", (code) => {
				sourceCode = code;
				finish();
			});
			sink.on("close", (code) => {
				sinkCode = code;
				finish();
			});
		});
	if (format === "deb")
		return readEntry("dpkg-deb", ["--fsys-tarfile", packagePath], "tar", ["-xOf", "-", `.${APPORT_POLICY_PATH}`]);
	if (format === "rpm")
		return readEntry("rpm2cpio", [packagePath], "cpio", ["--extract", "--to-stdout", `.${APPORT_POLICY_PATH}`]);
	throw new Error(`Unsupported Linux package format: ${format}`);
}

export async function verifyLinuxPackages({ releaseDir = defaultReleaseDir } = {}) {
	if (process.platform !== "linux") {
		throw new Error("[verify-linux-packages] native Linux package verification must run on Linux");
	}
	const [expectedVersion, debPath, rpmPath] = await Promise.all([
		readExpectedVersion(releaseDir),
		findExactlyOnePackage(releaseDir, ".deb"),
		findExactlyOnePackage(releaseDir, ".rpm"),
	]);
	const [debFields, debContents, rpmFields, rpmContents] = await Promise.all([
		execFileAsync("dpkg-deb", ["--field", debPath]),
		execFileAsync("dpkg-deb", ["--contents", debPath]),
		execFileAsync("rpm", ["-qp", "--queryformat", "%{NAME}\\n%{VERSION}\\n%{ARCH}\\n", rpmPath]),
		execFileAsync("rpm", ["-qlp", rpmPath]),
	]);
	const [debPolicy, rpmPolicy] = await Promise.all([
		readPackagedCrashPolicy("deb", debPath),
		readPackagedCrashPolicy("rpm", rpmPath),
	]);
	const inspection = {
		deb: {
			...parseDebFields(debFields.stdout),
			crashPolicy: debPolicy,
			paths: parseDebContents(debContents.stdout),
		},
		rpm: {
			...parseRpmFields(rpmFields.stdout),
			crashPolicy: rpmPolicy,
			paths: rpmContents.stdout.split(/\r?\n/).filter(Boolean),
		},
	};
	verifyLinuxPackageInspection({ expectedVersion, ...inspection });
	console.info(`[verify-linux-packages] Debian and RPM packages verified: ${expectedVersion}`);
	return { version: expectedVersion, ...inspection };
}

export async function main() {
	await verifyLinuxPackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
