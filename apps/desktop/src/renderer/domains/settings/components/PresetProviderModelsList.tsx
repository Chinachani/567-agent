import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import {
	PresetProviderModelsListView,
	type PresetProviderModelTestView,
	type PresetProviderModelsListViewLabels,
} from "@vetta-org/theme-ui/settings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PresetProviderRow, PresetProvidersSectionLabels } from "./usePresetProvidersSectionModel";

export function PresetProviderModelsList({
	row,
	labels,
}: {
	row: PresetProviderRow;
	labels: PresetProvidersSectionLabels;
}): JSX.Element {
	const [searchQuery, setSearchQuery] = useState("");
	const [tests, setTests] = useState<Record<string, PresetProviderModelTestView>>({});
	const providerId = row.id;
	const requests = useRef(new Set<string>());
	const revision = useRef(0);
	useEffect(() => {
		++revision.current;
		requests.current.clear();
		setTests({});
		return () => {
			++revision.current;
		};
	}, [providerId, row.baseUrl, row.enabled]);
	// 沿用「测试连通」语义：只判服务可达，不发真实推理请求；探测读 models.json，故需已启用。
	const testModel = useCallback(
		async (modelId: string): Promise<void> => {
			if (requests.current.has(modelId)) return;
			requests.current.add(modelId);
			const version = revision.current;
			const patch = (test: PresetProviderModelTestView): void => {
				if (revision.current === version) setTests((prev) => ({ ...prev, [modelId]: test }));
			};
			patch({ status: "testing" });
			try {
				await waitForCommittedPaint();
				if (revision.current !== version) return;
				const result = await window.agent567.models.probe({ provider: providerId, model: modelId });
				patch({ status: result.ok ? "ok" : "fail", message: result.ok ? result.message : result.error });
			} catch (err) {
				patch({ status: "fail", message: err instanceof Error ? err.message : String(err) });
			} finally {
				if (revision.current === version) requests.current.delete(modelId);
			}
		},
		[providerId],
	);
	const normalizedQuery = searchQuery.trim().normalize("NFKC").toLocaleLowerCase();
	const allRows = useMemo(
		() => row.modelRows.map((model) => ({ ...model, test: tests[model.id] })),
		[row.modelRows, tests],
	);
	const modelRows = useMemo(() => {
		if (!normalizedQuery) return allRows;
		return allRows.filter((model) => {
			const searchable = `${model.name}\n${model.id}`.normalize("NFKC").toLocaleLowerCase();
			return searchable.includes(normalizedQuery);
		});
	}, [allRows, normalizedQuery]);
	const viewLabels: PresetProviderModelsListViewLabels = {
		clearSearch: labels.clearModelSearch,
		listLabel: labels.modelListLabel(row.displayName),
		noMatchingModels: labels.noMatchingModels,
		noModels: labels.noModels,
		perMillionTokens: labels.perMillionTokens,
		searchPlaceholder: labels.searchModels(row.displayName),
		thinking: labels.thinking,
		testAction: labels.testConnect,
		testing: labels.testing,
		testOk: labels.testOk,
		testFail: labels.testFailed,
	};
	return (
		<PresetProviderModelsListView
			labels={viewLabels}
			modelRows={modelRows}
			onSearchQueryChange={setSearchQuery}
			onTest={row.adopted && row.enabled ? (id) => void testModel(id) : undefined}
			searchQuery={searchQuery}
			totalModelCount={row.modelRows.length}
		/>
	);
}
