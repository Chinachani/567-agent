import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@567agent/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@567agent/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			"@567agent/runtime-core/conversation": fileURLToPath(
				new URL("./src/conversation/index.ts", import.meta.url),
			),
			"@567agent/runtime-core/kernel": fileURLToPath(new URL("./src/kernel/index.ts", import.meta.url)),
			"@567agent/runtime-core/sandbox": fileURLToPath(new URL("./src/sandbox/index.ts", import.meta.url)),
			"@567agent/runtime-core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: "node",
	},
});
