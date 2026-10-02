import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default defineWorkersConfig({
	test: {
		pool: fileURLToPath(import.meta.resolve("@cloudflare/vitest-pool-workers")),
		poolOptions: {
			workers: {
				isolatedStorage: false,
				singleWorker: true,
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
	resolve: {
		alias: {
			"@567agent/remote-control": resolve(__dirname, "../../packages/remote-control/src/index.ts"),
			"@567agent/remote-desktop/protocol": resolve(__dirname, "../../packages/remote-desktop/src/protocol-entry.ts"),
			"@567agent/remote-desktop": resolve(__dirname, "../../packages/remote-desktop/src/index.ts"),
		},
	},
});
