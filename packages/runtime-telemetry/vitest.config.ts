import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { alias: {
	"@567agent/runtime-core/observation": fileURLToPath(new URL("../runtime-core/src/observation/index.ts", import.meta.url)),
	"@567agent/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
} }, test: { environment: "node" } });
