import catalog from "./model-context-catalog.generated.json";
import reviewed from "./model-context-references.json";

export interface ModelParameterRange {
	readonly min: number;
	readonly max: number;
	readonly minExclusive?: boolean;
	readonly maxExclusive?: boolean;
}
export interface ModelReferenceCapabilities {
	readonly input?: readonly string[];
	readonly output?: readonly string[];
	readonly tools?: boolean;
	readonly reasoning?: boolean;
	readonly temperature?: boolean;
	readonly topP?: boolean;
	readonly samplingConstraint?: string;
	readonly temperatureRange?: ModelParameterRange;
	readonly topPRange?: ModelParameterRange;
	readonly reasoningOptions?: readonly { type: string; values?: readonly string[]; min?: number; max?: number }[];
	readonly sourceUrl: string;
	readonly parameterSourceUrl?: string;
}
interface ModelReferenceLimits {
	readonly capacity: number | null;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly capabilities?: ModelReferenceCapabilities;
}
export interface ContextReferenceCatalog {
	fetchedAt: string;
	sourceUrl: string;
	providers?: Record<string, number>;
	models: Record<string, ModelReferenceLimits>;
}
export interface ModelContextReference extends ModelReferenceLimits {
	readonly modelId: string;
	readonly sourceUrl: string;
	readonly checkedAt: string;
	readonly alias: boolean;
}
interface ReviewedModelReference extends ModelReferenceLimits {
	readonly id: string;
	readonly aliases?: readonly string[];
	readonly sourceUrl: string;
}
export function buildModelContextReferences(
	catalog: ContextReferenceCatalog,
	reviewed: { checkedAt: string; models: readonly ReviewedModelReference[] },
): Map<string, ModelContextReference> {
	const references = new Map<string, ModelContextReference>();
	for (const [id, entry] of Object.entries(catalog.models)) {
		references.set(id, {
			...entry,
			modelId: id,
			sourceUrl: catalog.sourceUrl,
			checkedAt: catalog.fetchedAt.slice(0, 10),
			alias: false,
		});
	}
	for (const entry of reviewed.models) {
		if (
			entry.capacity !== null &&
			(!Number.isSafeInteger(entry.capacity) || entry.capacity < 1024 || entry.capacity > 10_000_000)
		)
			throw new Error(`Invalid reviewed context: ${entry.id}`);
		const previous = references.get(entry.id);
		const { id, aliases, ...details } = entry;
		const reference: ModelContextReference = {
			...previous,
			...details,
			modelId: id,
			checkedAt: reviewed.checkedAt,
			alias: false,
			...(entry.capabilities ? { capabilities: { ...previous?.capabilities, ...entry.capabilities } } : {}),
		};
		references.set(id, reference);
		for (const alias of aliases ?? []) references.set(alias, { ...reference, alias: true });
	}
	return references;
}
const references = buildModelContextReferences(catalog, reviewed);
export function getModelContextReference(id: string): ModelContextReference | undefined {
	return references.get(id);
}
