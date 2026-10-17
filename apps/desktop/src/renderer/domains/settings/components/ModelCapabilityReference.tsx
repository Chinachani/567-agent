import { Button } from "@shared/components/ui/button";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelContextReference, ModelParameterRange } from "../../../../shared/model-context-reference";

export function ModelCapabilityReference({ reference }: { reference: ModelContextReference }): JSX.Element {
	const { t } = useTranslation("settings");
	const [open, setOpen] = useState(false);
	const contentId = useId();
	const { capabilities, maxInputTokens } = reference;
	const supported = (value?: boolean) =>
		t(value === undefined ? "modelContext.unknown" : value ? "modelContext.supported" : "modelContext.unsupported");
	const range = (value?: ModelParameterRange) =>
		value ? `${value.minExclusive ? "(" : "["}${value.min}, ${value.max}${value.maxExclusive ? ")" : "]"}` : "";
	const modalities = (values?: readonly string[]) =>
		values
			?.map((value) => {
				switch (value) {
					case "text":
						return t("modelContext.modalities.text");
					case "image":
						return t("modelContext.modalities.image");
					case "audio":
						return t("modelContext.modalities.audio");
					case "video":
						return t("modelContext.modalities.video");
					case "pdf":
						return "PDF";
					default:
						return value;
				}
			})
			.join(" / ") || t("modelContext.unknown");
	const thinking =
		capabilities?.reasoningOptions
			?.map((option) => {
				switch (option.type) {
					case "effort":
						return option.values?.join(" / ") || t("modelContext.unknown");
					case "toggle":
						return t("modelContext.thinkingToggle");
					case "fixed":
						return t("modelContext.thinkingFixed");
					case "budget_tokens":
						return t("modelContext.thinkingBudget", { min: option.min ?? "?", max: option.max ?? "?" });
					default:
						return t("modelContext.unknown");
				}
			})
			.join("; ") || t("modelContext.unknown");
	const fields = [
		[t("modelContext.maxInput"), maxInputTokens?.toLocaleString() ?? t("modelContext.unknown")],
		[t("modelContext.inputTypes"), modalities(capabilities?.input)],
		[t("modelContext.outputTypes"), modalities(capabilities?.output)],
		[t("modelContext.tools"), supported(capabilities?.tools)],
		[t("modelContext.reasoning"), `${supported(capabilities?.reasoning)} · ${thinking}`],
		[t("modelContext.temperature"), `${supported(capabilities?.temperature)} ${range(capabilities?.temperatureRange)}`],
		[t("modelContext.topP"), `${supported(capabilities?.topP)} ${range(capabilities?.topPRange)}`],
	];
	return (
		<div className="rounded-xl border border-border/50 bg-card/40 text-[12px]">
			<Button
				variant="ghost"
				className="h-auto w-full justify-between gap-3 p-4 text-left"
				aria-expanded={open}
				aria-controls={contentId}
				onClick={() => setOpen(!open)}
			>
				<span className="min-w-0">
					<span className="block text-[13px] font-medium text-foreground">{t("modelContext.capabilities")}</span>
					<span className="mt-1 block truncate text-[11px] text-muted-foreground">
						{reference.modelId} · {reference.checkedAt}
					</span>
				</span>
				<span
					aria-hidden="true"
					className={
						open ? "icon-[solar--alt-arrow-up-linear] h-3.5 w-3.5" : "icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5"
					}
				/>
			</Button>
			{open && (
				<div id={contentId} className="space-y-3 border-t border-border/30 p-4">
					<p className="text-muted-foreground">
						{t("modelContext.reference", {
							model: reference.modelId,
							capacity: reference.capacity?.toLocaleString() ?? t("modelContext.unknown"),
							output: reference.maxOutputTokens?.toLocaleString() ?? t("modelContext.unknown"),
							date: reference.checkedAt,
						})}
					</p>
					<dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
						{fields.map(([label, value]) => (
							<div key={label} className="space-y-1">
								<dt className="text-[11px] text-muted-foreground">{label}</dt>
								<dd className="break-words text-[13px]">{value}</dd>
							</div>
						))}
					</dl>
					<p className="text-[11px] text-muted-foreground">{t("modelContext.capabilitiesHint")}</p>
					{reference.alias && <p className="text-muted-foreground">{t("modelContext.aliasHint")}</p>}
					{capabilities?.samplingConstraint === "reasoningNoneOnly" && (
						<p className="rounded-lg bg-muted p-2 text-muted-foreground">{t("modelContext.reasoningNoneOnly")}</p>
					)}
					{capabilities?.samplingConstraint === "deepseekModes" && (
						<p className="rounded-lg bg-muted p-2 text-muted-foreground">{t("modelContext.deepseekModes")}</p>
					)}
					<div className="flex flex-wrap gap-3 text-muted-foreground">
						{!reference.sourceUrl.endsWith("/v1/models") && (
							<a className="underline underline-offset-2" href={reference.sourceUrl} target="_blank" rel="noreferrer">
								{t("modelContext.referenceLink")}
							</a>
						)}
						{capabilities && (
							<a
								className="underline underline-offset-2"
								href={capabilities.sourceUrl}
								target="_blank"
								rel="noreferrer"
							>
								{t("modelContext.capabilitiesLink")}
							</a>
						)}
						{capabilities?.parameterSourceUrl && (
							<a
								className="underline underline-offset-2"
								href={capabilities.parameterSourceUrl}
								target="_blank"
								rel="noreferrer"
							>
								{t("modelContext.parametersLink")}
							</a>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
