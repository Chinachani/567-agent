import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@567agent/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@567agent/runtime-knowledge": fileURLToPath(new URL("../runtime-knowledge/src/index.ts", import.meta.url)),
			"@567agent/runtime-subagents": fileURLToPath(new URL("../runtime-subagents/src/index.ts", import.meta.url)),
			"@567agent/runtime-core/configuration": fileURLToPath(
				new URL("../runtime-core/src/configuration/index.ts", import.meta.url),
			),
			"@567agent/runtime-core/observation": fileURLToPath(
				new URL("../runtime-core/src/observation/index.ts", import.meta.url),
			),
			"@567agent/runtime-core/kernel": fileURLToPath(
				new URL("../runtime-core/src/kernel/index.ts", import.meta.url),
			),
			"@567agent/runtime-core": fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		server: {
			deps: {
				external: ["glob", "ignore"],
			},
		},
	},
});
