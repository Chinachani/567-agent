import { Button } from "@shared/components/ui/button";
import { MotionSelect } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import type { ModelsConfigData } from "../../../../preload/api-types/models";
import { parseContextCapacityInput } from "../../../../shared/model-context";
import { isModelInferenceApi } from "../../../../shared/model-inference-api";
import { ModelCapabilityReference } from "./ModelCapabilityReference";
import { InputField } from "./SettingsFormFields";
import { useModelContextSettingsModel } from "./useModelContextSettingsModel";

const PRESETS = ["32K", "64K", "128K", "200K", "1M"];

export function ModelContextSettings({ config }: { config: ModelsConfigData }): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useModelContextSettingsModel(config);
	return (
		<section className="mt-6 space-y-3" aria-label={t("modelContext.title")}>
			<div>
				<h2 className="text-[14px] font-semibold">{t("modelContext.title")}</h2>
				<p className="mt-1 text-[12px] text-muted-foreground">{t("modelContext.description")}</p>
			</div>
			{model.count === 0 ? (
				<p className="text-[12px] text-muted-foreground">{t("modelContext.empty")}</p>
			) : (
				<>
					<div className="space-y-4 rounded-xl border border-border/50 bg-card/40 p-4">
						<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] items-end gap-3">
							<form
								className="space-y-1.5"
								onSubmit={(event) => {
									event.preventDefault();
									model.search();
								}}
							>
								<label className="block text-[12px] text-muted-foreground">{t("modelContext.search")}</label>
								<div className="flex min-w-0 gap-2">
									<InputField
										aria-label={t("modelContext.search")}
										className="min-w-0 flex-1"
										value={model.query}
										onChange={model.setQuery}
										disabled={model.busy}
										placeholder={t("modelContext.searchPlaceholder")}
									/>
									<Button type="submit" variant="outline" disabled={model.busy || !model.query.trim()}>
										{t("modelContext.searchAction")}
									</Button>
								</div>
							</form>
							<div className="space-y-1.5 text-[12px] text-muted-foreground">
								<span>{t("modelContext.model")}</span>
								<MotionSelect
									aria-label={t("modelContext.model")}
									triggerClassName="w-full"
									value={model.selected}
									onValueChange={model.setSelection}
									disabled={model.busy}
									options={model.options}
								/>
							</div>
						</div>
						{model.submittedQuery !== null && (
							<section className="space-y-2" aria-label={t("modelContext.resultsTitle")}>
								<p role="status" className="text-[12px] text-muted-foreground">
									{model.results.length === 0
										? t("modelContext.noMatches")
										: t("modelContext.resultsCount", { count: model.results.length })}
								</p>
								<div className="flex flex-col gap-1">
									{model.results.slice(0, 8).map((entry) => (
										<Button
											key={entry.value}
											variant={entry.value === model.selected ? "secondary" : "ghost"}
											className="h-auto min-h-8 justify-start whitespace-normal text-left"
											disabled={model.busy}
											onClick={() => model.setSelection(entry.value)}
											aria-pressed={entry.value === model.selected}
										>
											{entry.label}
										</Button>
									))}
								</div>
								{model.results.length > 8 && (
									<p className="text-[12px] text-muted-foreground">{t("modelContext.refineSearch")}</p>
								)}
								<Button variant="ghost" size="xs" onClick={model.clearSearch}>
									{t("modelContext.clearSearch")}
								</Button>
							</section>
						)}
						{model.protocolSupported && (
							<div className="space-y-2 border-t border-border/30 pt-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span className="text-[12px] font-medium">{t("modelContext.protocol")}</span>
									<MotionSelect
										aria-label={t("modelContext.protocol")}
										value={model.protocol}
										disabled={model.busy}
										onValueChange={(value) => {
											if (value === "auto" || isModelInferenceApi(value))
												void model.saveProtocol(value === "auto" ? null : value);
										}}
										options={[
											{
												value: "auto",
												label: t("modelContext.protocolAuto", {
													protocol: t(
														model.automaticApi === "openai-responses"
															? "modelContext.protocolResponses"
															: "modelContext.protocolCompletions",
													),
												}),
											},
											{ value: "openai-responses", label: t("modelContext.protocolResponses") },
											{ value: "openai-completions", label: t("modelContext.protocolCompletions") },
										]}
									/>
								</div>
								<p className="text-[11px] text-muted-foreground">{t("modelContext.protocolHint")}</p>
								{(model.notice === "protocolSaved" || model.notice === "protocolFailed") && (
									<p
										role="status"
										className={`text-[12px] ${model.notice === "protocolFailed" ? "text-destructive" : "text-muted-foreground"}`}
									>
										{t(`modelContext.${model.notice}`)}
									</p>
								)}
							</div>
						)}
						<div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/30 py-4">
							<div>
								<p className="mb-1 text-[12px] text-muted-foreground">{t("modelContext.currentLimit")}</p>
								<p className="text-[20px] font-semibold tabular-nums tracking-tight">
									{model.info.capacity?.toLocaleString() ?? t("modelContext.unknown")}
									{model.info.capacity !== undefined && (
										<span className="ml-2 text-[12px] font-normal text-muted-foreground">tokens</span>
									)}
								</p>
							</div>
							<span
								title={t("modelContext.priorityHint")}
								className={`rounded-full border border-border/40 px-2.5 py-1 text-[11px] ${model.info.source === "manual" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}
							>
								{t(`modelContext.source.${model.info.source}`)}
							</span>
						</div>
						{model.info.source === "unknown" && (
							<p className="text-[12px] text-muted-foreground">{t("modelContext.unknownHint")}</p>
						)}
						<div className="space-y-2.5">
							<label className="block space-y-1.5 text-[12px]">
								{t("modelContext.override")}
								<InputField
									value={model.draft}
									onChange={model.setDraft}
									disabled={model.busy}
									placeholder={t("modelContext.placeholder")}
									className={!model.valid ? "border-destructive" : undefined}
									onKeyDown={(event) => {
										if (
											event.key === "Enter" &&
											!event.nativeEvent.isComposing &&
											model.valid &&
											!model.busy
										) {
											event.preventDefault();
											void model.save();
										}
									}}
								/>
							</label>
							<div className="flex flex-wrap items-center gap-1.5" aria-label={t("modelContext.presets")}>
								{PRESETS.map((value) => (
									<Button
										key={value}
										size="xs"
										className="rounded-full"
										variant={model.parsed === parseContextCapacityInput(value) ? "secondary" : "outline"}
										aria-pressed={model.parsed === parseContextCapacityInput(value)}
										disabled={model.busy}
										onClick={() => model.setDraft(value)}
									>
										{value}
									</Button>
								))}
								{model.automatic.capacity && (
									<Button
										size="xs"
										variant="ghost"
										disabled={model.busy}
										onClick={() => model.setDraft(String(model.automatic.capacity))}
									>
										{t("modelContext.fillReference")}
									</Button>
								)}
							</div>
							<p className="text-[11px] text-muted-foreground">
								{model.parsed === undefined
									? t("modelContext.unitsHint")
									: t("modelContext.parsed", { capacity: model.parsed.toLocaleString() })}
							</p>
							{!model.valid && (
								<p role="alert" className="text-[12px] text-destructive">
									{t("modelContext.invalid")}
								</p>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								variant="primary"
								disabled={model.busy || !model.valid}
								onClick={() => void model.save()}
							>
								{t(model.busy ? "modelContext.saving" : "modelContext.save")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={model.busy || (model.info.manual === undefined && !model.draft)}
								onClick={() => void model.restore()}
							>
								{t("modelContext.automatic")}
							</Button>
							{model.notice && model.notice !== "protocolSaved" && model.notice !== "protocolFailed" && (
								<p
									role="status"
									className={`text-[12px] ${model.notice === "failed" ? "text-destructive" : "text-muted-foreground"}`}
								>
									{t(`modelContext.${model.notice}`)}
								</p>
							)}
						</div>
					</div>
					{model.reference && <ModelCapabilityReference key={model.selected} reference={model.reference} />}
				</>
			)}
		</section>
	);
}
