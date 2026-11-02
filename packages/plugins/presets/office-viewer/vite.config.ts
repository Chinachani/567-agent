import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";

const pdfPackage = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

export default defineConfig({
	plugins: [
		{
			name: "office-offline-pdf-resources",
			apply: "build",
			async generateBundle() {
				// Predefined CJK maps and non-embedded standard fonts are requested
				// only by PDF previews. Keep them local instead of relying on a CDN.
				for (const folder of ["cmaps", "standard_fonts"]) {
					for (const name of await readdir(join(pdfPackage, folder))) {
						if (!/\.(bcmap|pfb|ttf)$/.test(name) && name !== "LICENSE") continue;
						this.emitFile({
							type: "asset",
							fileName: `assets/pdfjs/${folder}/${name}`,
							source: await readFile(join(pdfPackage, folder, name)),
						});
					}
				}
			},
		},
		tailwindcss(),
		vettaPluginFederation({
			name: "office_viewer",
			entry: "./src/index.tsx",
			hostUi: true,
		}),
	],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
});
