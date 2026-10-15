import { useTranslation } from "react-i18next";
import type { ModelParameterRange, ModelReferenceCapabilities } from "../../../../shared/model-context-reference";

export function ModelCapabilityReference({
	capabilities,
	maxInputTokens,
}: {
	capabilities?: ModelReferenceCapabilities;
	maxInputTokens?: number;
}): JSX.Element {
	const { t } = useTranslation("settings");
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
		<details className="space-y-2 text-[12px] text-muted-foreground">
			<summary className="cursor-pointer">{t("modelContext.capabilities")}</summary>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
				{fields.map(([label, value]) => (
					<div className="contents" key={label}>
						<dt>{label}</dt>
						<dd className="break-words">{value}</dd>
					</div>
				))}
			</dl>
			<p>{t("modelContext.capabilitiesHint")}</p>
			{capabilities?.samplingConstraint === "reasoningNoneOnly" && <p>{t("modelContext.reasoningNoneOnly")}</p>}
			{capabilities?.samplingConstraint === "deepseekModes" && <p>{t("modelContext.deepseekModes")}</p>}
			{capabilities && (
				<div className="flex flex-wrap gap-3">
					<a className="underline underline-offset-2" href={capabilities.sourceUrl} target="_blank" rel="noreferrer">
						{t("modelContext.capabilitiesLink")}
					</a>
					{capabilities.parameterSourceUrl && (
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
			)}
		</details>
	);
}
