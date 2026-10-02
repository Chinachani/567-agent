import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@567agent/runtime-core/conversation": fileURLToPath(
				new URL("../runtime-core/src/conversation/index.ts", import.meta.url),
			),
			"@567agent/runtime-core/kernel": fileURLToPath(new URL("../runtime-core/src/kernel/index.ts", import.meta.url)),
			"@567agent/runtime-core/sandbox": fileURLToPath(
				new URL("../runtime-core/src/sandbox/index.ts", import.meta.url),
			),
			"@567agent/runtime-core": fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
	},
});
