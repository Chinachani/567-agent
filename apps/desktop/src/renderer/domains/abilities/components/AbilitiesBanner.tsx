import { useTranslation } from "react-i18next";

/** 简要说明公开能力的添加方式与未核验 MCP 的人工接入流程。 */
export function AbilitiesBanner(): JSX.Element {
	const { t } = useTranslation("abilities");

	return (
		<section
			data-tour="capabilities-banner"
			aria-labelledby="abilities-usage-summary"
			className="rounded-lg bg-muted/30 px-3 py-2"
		>
			<details className="group">
				<summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-md text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
					<span className="min-w-0 flex-1 basis-40 text-muted-foreground">{t("banner.summary")}</span>
					<span id="abilities-usage-summary" className="inline-flex items-center gap-1 text-foreground">
						{t("banner.viewGuide")}
						<span
							aria-hidden="true"
							className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 group-open:rotate-180"
						/>
					</span>
				</summary>
				<div className="mt-3 border-t border-border/60 pt-3">
					<h2 className="text-[13px] font-semibold text-foreground">{t("banner.title")}</h2>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("banner.description")}</p>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<div className="border-l border-border/70 pl-3 py-1">
							<p className="text-[12px] font-medium text-foreground">{t("banner.catalogTitle")}</p>
							<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("banner.catalogHint")}</p>
						</div>
						<div className="border-l border-border/70 pl-3 py-1">
							<p className="text-[12px] font-medium text-foreground">{t("banner.unreviewedTitle")}</p>
							<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
								{t("banner.unreviewedHint")}
							</p>
						</div>
					</div>
				</div>
			</details>
		</section>
	);
}
