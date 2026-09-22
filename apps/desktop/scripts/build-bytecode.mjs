import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import electronPath from "electron";
import { createBytecodeCompileScript } from "./build-bytecode-script.mjs";

const projectRoot = join(import.meta.dirname, "..");
const distMainDir = join(projectRoot, "dist", "main");
const srcSecurityTs = join(projectRoot, "src", "main", "567api", "security.ts");
const outCjs = join(distMainDir, "567api-security.cjs");
const outJsc = join(distMainDir, "567api-security.jsc");
const outLoader = join(distMainDir, "567api-security-loader.cjs");

mkdirSync(distMainDir, { recursive: true });

console.log("[build-bytecode] 1. Bundling security module into CommonJS...");
execSync(
	`bun build "${srcSecurityTs}" --target=node --format=cjs --outfile="${outCjs}"`,
	{ cwd: projectRoot, stdio: "inherit" },
);

console.log("[build-bytecode] 2. Compiling CommonJS bundle into V8 Bytecode (.jsc)...");
const compileScript = createBytecodeCompileScript(outCjs, outJsc);

execFileSync(electronPath, ["--no-lazy", "-e", compileScript], {
	env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	stdio: "inherit",
});

console.log("[build-bytecode] 3. Generating safe bytecode loader...");
const loaderCode = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const v8 = require("node:v8");

v8.setFlagsFromString("--no-lazy");

const jscPath = path.join(__dirname, "567api-security.jsc");

function loadBytecode() {
	if (!fs.existsSync(jscPath)) {
		throw new Error("Missing 567api-security.jsc bytecode asset");
	}
	const buf = fs.readFileSync(jscPath);
	const length = buf.readUInt32LE(0);
	const cachedData = buf.subarray(4);
	const dummy = " ".repeat(length);

	const script = new vm.Script(dummy, { cachedData });
	if (script.cachedDataRejected) {
		throw new Error("V8 bytecode rejected by current Electron runtime");
	}
	const fn = script.runInThisContext();
	const mod = { exports: {} };
	fn(mod.exports, require, mod, jscPath, __dirname);
	return mod.exports;
}

module.exports = loadBytecode();
`;

writeFileSync(outLoader, loaderCode, "utf8");

console.log("[build-bytecode] 4. Removing plaintext CJS bundle to protect sensitive logic...");
if (existsSync(outCjs)) {
	rmSync(outCjs, { force: true });
}

console.log("[build-bytecode] Done! Security module is now hardened with V8 Bytecode.");
