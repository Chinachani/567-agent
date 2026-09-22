export function createBytecodeCompileScript(cjsPath, jscPath) {
	return `
const fs = require("node:fs");
const vm = require("node:vm");
const v8 = require("node:v8");
const Module = require("node:module");

const cjsPath = ${JSON.stringify(cjsPath)};
const jscPath = ${JSON.stringify(jscPath)};

const sourceCode = fs.readFileSync(cjsPath, "utf8");
const wrapped = Module.wrap(sourceCode);

v8.setFlagsFromString("--no-lazy");
const script = new vm.Script(wrapped, { produceCachedData: true });
const cachedData = script.createCachedData();

// 文件结构：4 字节 header（wrapped 源码长度）+ V8 cachedData 二进制
const header = Buffer.alloc(4);
header.writeUInt32LE(wrapped.length, 0);
const finalBuffer = Buffer.concat([header, cachedData]);

fs.writeFileSync(jscPath, finalBuffer);
console.log("[build-bytecode] V8 Bytecode successfully produced: " + jscPath + " (" + finalBuffer.length + " bytes)");
`;
}
