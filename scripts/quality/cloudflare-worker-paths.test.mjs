import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(new URL("../../apps/remote-relay/package.json", import.meta.url));
const source = readFileSync(
	join(dirname(require.resolve("@cloudflare/vitest-pool-workers/config")), "../pool/index.mjs"),
	"utf8",
);
const directories = [];

// Exercise the installed, pinned patch itself. The Worker suite additionally
// covers complete ESM/CJS resolution, redirects, and serialized startup data.
function installedFunction(name, globals = {}) {
	const start = source.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`Missing patched function: ${name}`);
	const end = source.indexOf("\n}", start) + 2;
	return runInNewContext(`(${source.slice(start, end)})`, globals);
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Cloudflare test pool path compatibility", () => {
	it("round trips Unicode and spaces through actual redirect headers and filesystem lookup", () => {
		const directory = mkdtempSync(join(tmpdir(), "567-agent-项目 "));
		directories.push(directory);
		const file = join(directory, "测试 file.mjs");
		writeFileSync(file, "export default 1;");
		const redirect = installedFunction("buildRedirectResponse", { isWindows: false, Response2: Response });
		const decode = installedFunction("decodeModulePath", {
			fs2: fs,
			disableCjsEsmShimSuffix: "?mf_vitest_no_cjs_esm_shim",
			trimSuffix: (suffix, value) => value.slice(0, -suffix.length),
		});
		const header = redirect(file).headers.get("Location");
		expect(header).toBe(encodeURI(file));
		expect(decode(header)).toBe(file);
		expect(decode(`${header}?mf_vitest_no_cjs_esm_shim`)).toBe(`${file}?mf_vitest_no_cjs_esm_shim`);
		const literalPercent = join(directory, "%20.mjs");
		writeFileSync(literalPercent, "export default 2;");
		expect(decode(literalPercent)).toBe(literalPercent);
		expect(decode("/missing/malformed%file.mjs")).toBe("/missing/malformed%file.mjs");
	});

	it("preserves JSON startup data including Chinese, emoji, and literal escapes in ASCII headers", () => {
		const encode = installedFunction("encodeHeaderValue");
		const data = { cwd: "/项目/567 Agent", label: "配对 🔑", literal: "\\u1234", files: ["test.mjs"] };
		const encoded = encode(JSON.stringify(data));
		const header = new Headers({ "MF-Vitest-Worker-Data": encoded }).get("MF-Vitest-Worker-Data");
		expect(header).toMatch(/^[\x20-\x7e]*$/);
		expect(JSON.parse(header)).toEqual(data);
		expect(encode('{"cwd":"/tmp/repo"}')).toBe('{"cwd":"/tmp/repo"}');
	});
});
