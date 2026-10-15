import { Button } from "@shared/components/ui/button";
import { MotionSelect } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import type { ModelsConfigData } from "../../../../preload/api-types/models";
import { ModelCapabilityReference } from "./ModelCapabilityReference";
import { InputField } from "./SettingsFormFields";
import { useModelContextSettingsModel } from "./useModelContextSettingsModel";

export function ModelContextSettings({ config }: { config: ModelsConfigData }): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useModelContextSettingsModel(config);
	const capacity = (value: number | undefined) => value?.toLocaleString() ?? t("modelContext.unknown");
	return (
		<section className="mt-6 space-y-3 border-t border-border pt-5" aria-label={t("modelContext.title")}>
			<h2 className="text-[14px] font-semibold">{t("modelContext.title")}</h2>
			<p className="text-[12px] text-muted-foreground">{t("modelContext.description")}</p>
			{model.count === 0 ? (
				<p className="text-[12px] text-muted-foreground">{t("modelContext.empty")}</p>
			) : (
				<>
					{model.count > 12 && (
						<label className="block space-y-1 text-[12px]">
							{t("modelContext.search")}
							<InputField
								value={model.query}
								onChange={model.setQuery}
								disabled={model.busy}
								placeholder={t("modelContext.searchPlaceholder")}
							/>
						</label>
					)}
					<label className="block space-y-1 text-[12px]">
						{t("modelContext.model")}
						<MotionSelect
							aria-label={t("modelContext.model")}
							triggerClassName="w-full"
							value={model.selected}
							onValueChange={model.setSelection}
							disabled={model.busy}
							options={model.options}
						/>
					</label>
					<p className="text-[13px]">
						{t("modelContext.effective", {
							capacity: capacity(model.info.capacity),
							source: t(`modelContext.source.${model.info.source}`),
						})}
					</p>
					{model.query && model.matchingCount === 0 && (
						<p role="status" className="text-[12px] text-muted-foreground">
							{t("modelContext.noMatches")}
						</p>
					)}
					{model.reference && (
						<div className="space-y-1 text-[12px] text-muted-foreground">
							<p>
								{t("modelContext.reference", {
									model: model.reference.modelId,
									capacity: capacity(model.reference.capacity ?? undefined),
									output: capacity(model.reference.maxOutputTokens),
									date: model.reference.checkedAt,
								})}
							</p>
							<ModelCapabilityReference
								capabilities={model.reference.capabilities}
								maxInputTokens={model.reference.maxInputTokens}
							/>
							{model.reference.alias && <p>{t("modelContext.aliasHint")}</p>}
							{!model.reference.sourceUrl.endsWith("/v1/models") && (
								<a
									href={model.reference.sourceUrl}
									target="_blank"
									rel="noreferrer"
									className="text-primary underline underline-offset-2"
								>
									{t("modelContext.referenceLink")}
								</a>
							)}
						</div>
					)}
					{model.info.source === "unknown" && (
						<p className="text-[12px] text-muted-foreground">{t("modelContext.unknownHint")}</p>
					)}
					<label className="block space-y-1 text-[12px]">
						{t("modelContext.override")}
						<InputField
							value={model.draft}
							onChange={model.setDraft}
							disabled={model.busy}
							placeholder={t("modelContext.placeholder")}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.nativeEvent.isComposing && model.valid && !model.busy) {
									event.preventDefault();
									void model.save();
								}
							}}
						/>
					</label>
					<p className="text-[12px] text-muted-foreground">
						{t("modelContext.inputHint", { capacity: capacity(model.parsed) })}
					</p>
					<div className="flex flex-wrap items-center gap-1.5" aria-label={t("modelContext.presets")}>
						<span className="text-[12px] text-muted-foreground">{t("modelContext.presets")}</span>
						{["32K", "64K", "128K", "200K", "1M"].map((value) => (
							<Button
								key={value}
								size="sm"
								variant="outline"
								disabled={model.busy}
								onClick={() => model.setDraft(value)}
							>
								{value}
							</Button>
						))}
						{model.automatic.capacity && (
							<Button
								size="sm"
								variant="ghost"
								disabled={model.busy}
								onClick={() => model.setDraft(String(model.automatic.capacity))}
							>
								{t("modelContext.fillReference")}
							</Button>
						)}
					</div>
					{!model.valid && (
						<p role="alert" className="text-[12px] text-destructive">
							{t("modelContext.invalid")}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button size="sm" disabled={model.busy || !model.valid} onClick={() => void model.save()}>
							{t(model.busy ? "modelContext.saving" : "modelContext.save")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={model.busy || (model.info.manual === undefined && !model.draft)}
							onClick={() => void model.restore()}
						>
							{t("modelContext.automatic")}
						</Button>
					</div>
					{model.notice && (
						<p role="status" className="text-[12px] text-muted-foreground">
							{t(`modelContext.${model.notice}`)}
						</p>
					)}
				</>
			)}
		</section>
	);
}
