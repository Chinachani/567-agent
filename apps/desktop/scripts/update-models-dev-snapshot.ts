/**
 * 重新生成随包内置的 models.dev 目录快照。
 *
 * 快照是网络不可达且无本地缓存时的兜底(国内网络下 models.dev 常在 TLS 阶段被阻断),
 * 运行时永远优先线上数据,拉到就覆盖它。所以它可以旧,但不能没有。
 *
 * 用法:
 *   bun run scripts/update-models-dev-snapshot.ts              # 联网从 models.dev 拉
 *   bun run scripts/update-models-dev-snapshot.ts --from x.json # 从本地文件生成
 *   bun run scripts/update-models-dev-snapshot.ts --from-bundled # 仅从内置快照生成手机容量表
 *
 * --from 接受两种文件:models.dev 原始 api.json,或本地缓存
 * ~/.567agent/agent/models-dev-cache.json(已裁剪过的目录)。网络拉不通时用后者。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, isCatalogUsable, type ModelsDevCatalog } from "../src/main/models/presets/models-dev.js";
import { MODELS_DEV_SNAPSHOT } from "../src/main/models/presets/models-dev-snapshot.generated.js";
import reviewed from "../src/shared/model-context-references.json";
import {
	buildModelContextReferences,
	type ModelReferenceCapabilities,
	type ContextReferenceCatalog,
} from "../src/shared/model-context-reference.js";

interface RawReferenceModel {
	limit?: { context?: number; input?: number; output?: number };
	modalities?: { input?: string[]; output?: string[] };
	tool_call?: boolean;
	reasoning?: boolean;
	temperature?: boolean;
	reasoning_options?: Array<{ type: string; values?: string[]; min?: number; max?: number }>;
}
interface RawCapacityProvider {
	name?: string;
	doc?: string;
	models?: Record<string, RawReferenceModel>;
}
let rawCapacityCatalog: Record<string, RawCapacityProvider> | undefined;

const OUTPUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../src/main/models/presets/models-dev-snapshot.generated.ts",
);

function parseArgs(): { from?: string } {
	const index = process.argv.indexOf("--from");
	return index === -1 ? {} : { from: process.argv[index + 1] };
}

async function loadCatalog(from: string | undefined): Promise<ModelsDevCatalog> {
	if (process.argv.includes("--from-bundled")) return MODELS_DEV_SNAPSHOT;
	const now = Date.now();
	if (!from) {
		const response = await fetch("https://models.dev/api.json", { headers: { Accept: "application/json" } });
		if (!response.ok) throw new Error(`models.dev 返回 ${response.status} ${response.statusText}`);
		rawCapacityCatalog = await response.json();
		return buildCatalog(rawCapacityCatalog!, now);
	}
	const parsed = JSON.parse(readFileSync(from, "utf8"));
	// 已经是本地缓存(裁剪过的目录)就原样用,否则按原始 api.json 折算。
	if (isCatalogUsable(parsed)) return parsed as ModelsDevCatalog;
	rawCapacityCatalog = parsed;
	return buildCatalog(parsed, now);
}

const { from } = parseArgs();
const catalog = await loadCatalog(from);
const counts = Object.entries(catalog.providers)
	.map(([id, models]) => `${id}=${Object.keys(models).length}`)
	.join(" ");

if (!process.argv.includes("--from-bundled")) {
	const source = `// AUTO-GENERATED models.dev 目录快照。不要手改——跑 \`bun run snapshot:models-dev\` 重新生成。
// 网络不可达且无本地缓存时的兜底(见 ADR-0050);运行时拉到线上数据就覆盖它。
import type { ModelsDevCatalog } from "./models-dev.js";

export const MODELS_DEV_SNAPSHOT: ModelsDevCatalog = ${JSON.stringify(catalog, null, "\t")};
`;
	const formatter = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("../../../node_modules/@biomejs/biome/bin/biome", import.meta.url)),
			"format",
			`--stdin-file-path=${OUTPUT}`,
		],
		{ input: source, encoding: "utf8" },
	);
	if (formatter.status !== 0) throw new Error(`Could not format the model snapshot: ${formatter.stderr}`);
	writeFileSync(OUTPUT, formatter.stdout);
}

console.log(`${process.argv.includes("--from-bundled") ? "复用已有快照" : "快照已更新"}：${OUTPUT}`);
console.log(
	`  来源：${from ?? (process.argv.includes("--from-bundled") ? "随包内置目录" : "https://models.dev/api.json")}`,
);
console.log(`  时间：${catalog.fetchedAt}`);
console.log(`  模型：${counts}`);

// Capacity lookup retains older IDs still exposed by gateways; picker generation
// filtering must not erase their reference limits.
const capacityOutput = join(
	dirname(fileURLToPath(import.meta.url)),
	"../src/shared/model-context-catalog.generated.json",
);
let capacityCatalog: ContextReferenceCatalog;
if (rawCapacityCatalog) {
	const models: ContextReferenceCatalog["models"] = {};
	const providers: Record<string, number> = {};
	const origins = [
		"google",
		"openai",
		"anthropic",
		"deepseek",
		"zai",
		"moonshotai",
		"alibaba",
		"xai",
		"minimax",
		"mistral",
		"volcengine",
		"cohere",
		"ai21",
		"stepfun",
		"xiaomi",
		"tencent-tokenhub",
		"bailing",
		"meta",
		"llama",
		"perplexity",
		"amazon-bedrock",
		"nvidia",
	];
	const validLimit = (value: number | undefined): value is number =>
		Number.isSafeInteger(value) && value! > 0 && value! <= 10_000_000;
	for (const key of origins) {
		const provider = rawCapacityCatalog[key];
		if (!provider) throw new Error(`Missing origin provider ${key}; refusing to silently shrink the reference catalog`);
		providers[key] = 0;
		for (const [id, model] of Object.entries(provider.models ?? {})) {
			// Aggregators expose other vendors with different limits. Only take their own models.
			if (key === "amazon-bedrock" && !/^(?:(?:us|eu|apac|global)\.)?amazon\./.test(id)) continue;
			if (key === "nvidia" && !id.startsWith("nvidia/")) continue;
			providers[key]++;
			const rawLimit = model.limit?.context;
			const capacity = validLimit(rawLimit) && rawLimit >= 1024 ? rawLimit : null;
			const capabilities: ModelReferenceCapabilities = {
				sourceUrl: "https://models.dev/api.json",
				...(model.modalities?.input ? { input: model.modalities.input } : {}),
				...(model.modalities?.output ? { output: model.modalities.output } : {}),
				...(typeof model.tool_call === "boolean" ? { tools: model.tool_call } : {}),
				...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
				...(typeof model.temperature === "boolean" ? { temperature: model.temperature } : {}),
				...(model.reasoning_options?.length ? { reasoningOptions: model.reasoning_options } : {}),
			};
			const entry = {
				capacity,
				...(validLimit(model.limit?.input) ? { maxInputTokens: model.limit.input } : {}),
				...(validLimit(model.limit?.output) ? { maxOutputTokens: model.limit.output } : {}),
				capabilities,
			};
			// Exact collisions retain the most conservative capacity and its accompanying metadata.
			if (!models[id] || (capacity !== null && (models[id].capacity === null || capacity < models[id].capacity!)))
				models[id] = entry;
		}
	}
	capacityCatalog = { fetchedAt: catalog.fetchedAt, sourceUrl: "https://models.dev/api.json", providers, models };
	writeFileSync(capacityOutput, `${JSON.stringify(capacityCatalog, null, 2)}\n`);
} else if (existsSync(capacityOutput)) {
	capacityCatalog = JSON.parse(readFileSync(capacityOutput, "utf8"));
} else {
	throw new Error(
		"No full reference catalog available. Fetch models.dev instead of generating an incomplete fallback.",
	);
}
const capacities = buildModelContextReferences(capacityCatalog, reviewed);
const mobileOutput = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../mobile/shared/src/commonMain/kotlin/org/agent567/android/core/model/BundledModelContexts.generated.kt",
);
const quote = (value: string): string => JSON.stringify(value).replaceAll("$", "\\$");
const list = (values: readonly string[] | undefined): string =>
	values ? `listOf(${values.map(quote).join(", ")})` : "null";
const range = (value: ModelReferenceCapabilities["temperatureRange"]): string =>
	value
		? `ModelParameterRange(${Number.isInteger(value.min) ? `${value.min}.0` : String(value.min)}, ${Number.isInteger(value.max) ? `${value.max}.0` : String(value.max)}, ${value.minExclusive ?? false}, ${value.maxExclusive ?? false})`
		: "null";
const capability = (value: ModelReferenceCapabilities | undefined): string => {
	if (!value) return "null";
	const thinking = value.reasoningOptions?.map(
		(option) =>
			`ModelReasoningOption(${quote(option.type)}, ${list(option.values)}, ${option.min ?? "null"}, ${option.max ?? "null"})`,
	);
	return `ModelReferenceCapabilities(input = ${list(value.input)}, output = ${list(value.output)}, tools = ${value.tools ?? "null"}, reasoning = ${value.reasoning ?? "null"}, temperature = ${value.temperature ?? "null"}, topP = ${value.topP ?? "null"}, samplingConstraint = ${value.samplingConstraint ? quote(value.samplingConstraint) : "null"}, temperatureRange = ${range(value.temperatureRange)}, topPRange = ${range(value.topPRange)}, reasoningOptions = ${thinking ? `listOf(${thinking.join(", ")})` : "null"}, sourceUrl = ${quote(value.sourceUrl)}, parameterSourceUrl = ${value.parameterSourceUrl ? quote(value.parameterSourceUrl) : "null"})`;
};
const rows = [...capacities]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(
		([id, value]) =>
			`    ${quote(id)} to BundledModelContext(${value.capacity === null ? "null" : `${value.capacity}L`}, ${value.maxOutputTokens === undefined ? "null" : `${value.maxOutputTokens}L`}, ${quote(value.modelId)}, ${quote(value.sourceUrl)}, ${quote(value.checkedAt)}, ${value.alias}, ${value.maxInputTokens ?? "null"}, ${capability(value.capabilities)}),`,
	);
// Keep JVM initializer methods below the bytecode size limit as the catalog grows.
const chunks: string[] = [];
for (let start = 0; start < rows.length; start += 40)
	chunks.push(
		`private fun modelContextChunk${chunks.length}(): Map<String, BundledModelContext> = mapOf(\n${rows.slice(start, start + 40).join("\n")}\n)`,
	);
writeFileSync(
	mobileOutput,
	`// AUTO-GENERATED by apps/desktop/scripts/update-models-dev-snapshot.ts. Do not edit.\npackage org.agent567.android.core.model\n\ninternal val bundledModelContexts: Map<String, BundledModelContext> = buildMap {\n${chunks.map((_, i) => `    putAll(modelContextChunk${i}())`).join("\n")}\n}\n\n${chunks.join("\n\n")}\n`,
);
console.log(
	`参考目录：${Object.keys(capacityCatalog.models).length}；含审核与别名：${capacities.size}；手机快照：${mobileOutput}`,
);
