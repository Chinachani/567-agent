import { useTranslation } from "react-i18next";

/** 简要说明公开能力的添加方式与未核验 MCP 的人工接入流程。 */
export function AbilitiesBanner(): JSX.Element {
	const { t } = useTranslation("abilities");

	return (
		<section
			data-tour="capabilities-banner"
			aria-labelledby="abilities-usage-title"
			className="rounded-2xl border border-border/50 bg-card/40 px-5 py-4 sm:px-6 sm:py-5"
		>
			<h2 id="abilities-usage-title" className="text-[15px] font-semibold tracking-tight text-foreground">
				{t("banner.title")}
			</h2>
			<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/70">{t("banner.description")}</p>
			<div className="mt-3 grid gap-3 sm:grid-cols-2">
				<div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
					<p className="text-[12px] font-medium text-foreground">{t("banner.catalogTitle")}</p>
					<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("banner.catalogHint")}</p>
				</div>
				<div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
					<p className="text-[12px] font-medium text-foreground">{t("banner.unreviewedTitle")}</p>
					<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("banner.unreviewedHint")}</p>
				</div>
			</div>
		</section>
	);
}
