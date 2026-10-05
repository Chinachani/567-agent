// @vitest-environment jsdom

import { selectedModelAtom } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { type ModelSelectorScope, useModelSelectorModel } from "./useModelSelectorModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@shared/store/model-catalog", () => ({
	modelCatalog: { revalidate: vi.fn(async () => undefined) },
}));

vi.mock("@shared/components/ModelSelect/useModelOptions", () => {
	const option = (provider: string, modelId: string) => ({
		provider,
		modelId,
		displayName: modelId,
		key: `${provider}/${modelId}`,
	});
	const options = [
		option("cli-proxy-api.google", "gemini-3.8-flash-high"),
		option("cli-proxy-api.responses", "gpt-5.5"),
	];
	return {
		useModelOptions: () => ({
			options,
			grouped: new Map([["cli-proxy-api.google", options]]),
			defaultKey: undefined,
			iconFor: () => undefined,
			labelFor: (provider: string) => provider,
		}),
	};
});

beforeEach(() => {
	localStorage.clear();
});

it("updates the current window model without persisting a cross-window preference", () => {
	const store = createStore();
	store.set(selectedModelAtom, "vetta-go/stale");
	const scope: ModelSelectorScope = {
		modelKey: "cli-proxy-api.responses/gpt-5.5",
		onModelSelect: vi.fn(),
		onReasoningSelect: vi.fn(),
	};
	const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
	const { result } = renderHook(() => useModelSelectorModel({ updateActiveSession: false, scope }), { wrapper });

	act(() => result.current.viewProps.onModelSelect("cli-proxy-api.google/gemini-3.8-flash-high"));

	expect(scope.onModelSelect).toHaveBeenCalledWith("cli-proxy-api.google/gemini-3.8-flash-high", undefined);
	expect(store.get(selectedModelAtom)).toBe("cli-proxy-api.google/gemini-3.8-flash-high");
	expect(localStorage.length).toBe(0);
});
