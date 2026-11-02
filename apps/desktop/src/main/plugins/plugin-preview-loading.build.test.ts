import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runFile = promisify(execFile);

// Federation resolves exposed entry paths against the plugin process cwd. A child
// also isolates each production config's federation singleton from the test runner.
const BUILD_GRAPH = String.raw`
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, loadConfigFromFile } from "vite";
async function runtimePlugins(option) {
  const resolved = await option;
  if (Array.isArray(resolved)) return (await Promise.all(resolved.map(runtimePlugins))).flat();
  return resolved && resolved.name !== "vetta-plugin-package" ? [resolved] : [];
}
const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, resolve("vite.config.ts"));
if (!loaded) throw new Error("Missing production config");
const result = await build({
  ...loaded.config, configFile: false, logLevel: "silent",
  plugins: await runtimePlugins(loaded.config.plugins),
  build: { ...loaded.config.build, write: false },
});
const chunks = new Map();
for (const output of Array.isArray(result) ? result : [result]) {
  if (!("output" in output)) throw new Error("Unexpected watch build");
  for (const entry of output.output) if (entry.type === "chunk") chunks.set(entry.fileName, entry);
}
const entryPath = resolve("src/index.tsx").replaceAll("\\", "/");
const entry = [...chunks.values()].find((chunk) => Object.keys(chunk.modules).some((id) => id.replaceAll("\\", "/") === entryPath));
if (!entry) throw new Error("Missing exposed entry");
const initial = new Set();
const visit = (name) => {
  if (initial.has(name)) return;
  initial.add(name);
  for (const dependency of chunks.get(name)?.imports ?? []) if (chunks.has(dependency)) visit(dependency);
};
visit(entry.fileName);
writeFileSync(process.argv[1], JSON.stringify({
  initial: [...initial].flatMap((name) => Object.keys(chunks.get(name)?.modules ?? {})),
  all: [...chunks.values()].flatMap((chunk) => Object.keys(chunk.modules)),
  initialBytes: [...initial].reduce((sum, name) => sum + Buffer.byteLength(chunks.get(name)?.code ?? ""), 0),
}));
`;

async function previewGraph(pluginId: string): Promise<{ initial: string[]; all: string[]; initialBytes: number }> {
	const root = resolve(__dirname, "../../../../../packages/plugins/presets", pluginId);
	const temporary = await mkdtemp(join(tmpdir(), "agent567-plugin-startup-"));
	const output = join(temporary, "graph.json");
	try {
		// Build the real production graph without writing archives or replacing local outputs.
		await runFile(process.execPath, ["--input-type=module", "-e", BUILD_GRAPH, output], {
			cwd: root,
			timeout: 60_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		return JSON.parse(await readFile(output, "utf8"));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

describe("production preview plugins at application startup", () => {
	it("registers Office previews without evaluating unused document engines", async () => {
		const graph = await previewGraph("office-viewer");
		for (const engine of ["pdfjs-dist", "docx-preview", "pptx-renderer", "xlsx"]) {
			expect(
				graph.all.some((id) => id.includes(engine)),
				`${engine} remains available`,
			).toBe(true);
			expect(
				graph.initial.some((id) => id.includes(engine)),
				`${engine} must load only for a preview`,
			).toBe(false);
		}
		console.info("[preview-startup] office initial bytes", graph.initialBytes);
	}, 60_000);

	it("registers the chart tool without evaluating the chart engine", async () => {
		const graph = await previewGraph("chart-renderer");
		expect(graph.all.some((id) => id.includes("chart.js"))).toBe(true);
		expect(graph.initial.some((id) => id.includes("chart.js"))).toBe(false);
		console.info("[preview-startup] chart initial bytes", graph.initialBytes);
	}, 60_000);
});
