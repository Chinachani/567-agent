// @vitest-environment jsdom
import { i18n, initI18n } from "@shared/i18n";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { ModelsModelForm } from "./ModelsModelForm";
import type { ModelFormState } from "./useModelsSettingsModel";
afterEach(cleanup);
it("reorders reasoning choices while preserving the selected default and other parameters", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	let saved: ModelFormState | undefined;
	function Form() {
		const [form, setForm] = useState<ModelFormState>({
			id: "model",
			name: "",
			api: "",
			reasoning: true,
			reasoningLevels: ["low", "high"],
			defaultReasoningLevel: "high",
			input: ["text"],
			contextWindow: "131072",
			maxTokens: "8192",
		});
		return (
			<ModelsModelForm
				form={form}
				setForm={setForm}
				onSave={() => {
					saved = form;
				}}
				onCancel={() => {}}
				saving={false}
				saveLabel="保存"
			/>
		);
	}
	render(<Form />);
	fireEvent.click(screen.getByRole("button", { name: "上移 high" }));
	fireEvent.click(screen.getByRole("button", { name: "保存" }));
	expect(saved).toMatchObject({
		reasoningLevels: ["high", "low"],
		defaultReasoningLevel: "high",
		contextWindow: "131072",
		maxTokens: "8192",
	});
});
