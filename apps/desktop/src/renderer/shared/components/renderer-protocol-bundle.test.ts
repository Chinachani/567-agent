import { resolve } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";

it("bundles failure projection and session extension contracts without AI providers or Node modules", async () => {
	const forbidden: string[] = [];
	await build({
		configFile: false,
		logLevel: "silent",
		plugins: [
			{
				name: "browser-contract-boundary",
				resolveId(id) {
					if (id === "@567agent/ai" || id.startsWith("node:") || /(?:^|\/)undici(?:\/|$)|\/oauth\//.test(id)) {
						forbidden.push(id);
						throw new Error(`Node dependency in browser contract: ${id}`);
					}
				},
			},
		],
		build: {
			write: false,
			minify: false,
			lib: {
				entry: [
					resolve("../../packages/runtime-core/src/failure-projection.ts"),
					resolve("../../packages/coding-agent/src/public-api/session-extensions.ts"),
				],
				formats: ["es"],
			},
		},
	});
	expect(forbidden).toEqual([]);
});
