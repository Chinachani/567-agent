import { ModelsProvidersSectionView } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { ModelsProviderForm } from "./ModelsProviderForm";
import { ModelsProviderRow } from "./ModelsProviderRow";
import { useState } from "react";
import { SettingsListSearch, matchesSettingsSearch } from "./SettingsListSearch";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

export function ModelsProvidersSection({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const [query, setQuery] = useState("");
	const names = model.providerNames.filter((name) => {
		const provider = model.config?.providers[name];
		return (
			name === model.editingProvider ||
			name === model.addingModelFor ||
			name === model.editingModel?.provider ||
			matchesSettingsSearch(query, [
				name,
				provider?.displayName ?? "",
				...(provider?.models?.flatMap((item) => [item.id, item.name ?? ""]) ?? []),
			])
		);
	});

	return (
		<ModelsProvidersSectionView
			section={SETTINGS_SECTION["models-providers"]}
			labels={{
				localProviders: t("localProviders"),
				addProvider: t("addProvider"),
				noProvidersAdded: t("noProvidersAdded"),
			}}
			showAddButton={!model.addingProvider}
			onStartAdd={model.onStartAddProvider}
			empty={model.providerNames.length === 0}
			toolbar={
				model.providerNames.length > 0 ? (
					<SettingsListSearch
						value={query}
						onChange={setQuery}
						label={t("listSearch.providers")}
						count={names.length}
						total={model.providerNames.length}
					/>
				) : null
			}
			rows={
				<>
					{query.trim() && (model.editingProvider || model.addingModelFor || model.editingModel) && (
						<p className="px-4 pb-2 text-[11px] text-muted-foreground">{t("listSearch.keepEditing")}</p>
					)}
					{names.length === 0 && model.providerNames.length > 0 && (
						<p role="status" className="px-4 py-6 text-center text-[12px] text-muted-foreground">
							{t("listSearch.noProviders")}
						</p>
					)}
					{names.map((name) => (
						<ModelsProviderRow key={name} name={name} model={model} />
					))}
				</>
			}
			addForm={
				model.addingProvider ? (
					<div className="border-t border-border px-5 py-4">
						<ModelsProviderForm
							form={model.providerForm}
							setForm={model.setProviderForm}
							onSave={() => void model.onAddProvider()}
							onCancel={model.onCancelAddProvider}
							saving={model.saving}
							saveLabel={t("add")}
						/>
					</div>
				) : null
			}
		/>
	);
}
