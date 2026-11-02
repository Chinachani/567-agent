import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
	plugins: [
		tailwindcss(),
		{
			name: "design-third-party-notices",
			generateBundle() {
				const source = [
					readFileSync(new URL("./vendor/taste-skill/UPSTREAM.md", import.meta.url), "utf8"),
					readFileSync(new URL("./vendor/taste-skill/LICENSE", import.meta.url), "utf8"),
					"Devices.css 0.2.0 — https://github.com/picturepan2/devices.css",
					readFileSync(require.resolve("devices.css/LICENSE"), "utf8"),
				].join("\n\n");
				this.emitFile({ type: "asset", fileName: "assets/THIRD-PARTY-NOTICES.txt", source });
			},
		},
		vettaPluginFederation({
			name: "vetta_ui_design",
			entry: "./src/index.tsx",
		}),
	],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
});
