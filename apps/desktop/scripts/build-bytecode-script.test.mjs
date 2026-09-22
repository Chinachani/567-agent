import assert from "node:assert/strict";
import { it } from "node:test";
import { createBytecodeCompileScript } from "./build-bytecode-script.mjs";

it("preserves Windows paths when generating the Electron bytecode compiler script", () => {
	const cjsPath = String.raw`D:\a\567-agent\567-agent\apps\desktop\dist\main\567api-security.cjs`;
	const jscPath = String.raw`D:\a\567-agent\567-agent\apps\desktop\dist\main\567api-security.jsc`;

	const script = createBytecodeCompileScript(cjsPath, jscPath);
	const pathDeclarations = script.match(/const cjsPath[\s\S]*?const jscPath[^;]+;/)?.[0];
	assert.ok(pathDeclarations);
	const resolvedPaths = new Function(`${pathDeclarations}\nreturn { cjsPath, jscPath };`)();

	assert.deepEqual(resolvedPaths, { cjsPath, jscPath });
});
