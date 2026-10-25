import { getDocsMessages, type DocsLanguage } from "@/lib/i18n";

export function BrandMark({ language = "zh" }: { language?: DocsLanguage }) {
	const text = getDocsMessages(language);

	return (
		<span className="inline-flex min-w-0 items-center gap-[0.7rem] tracking-normal">
			<span
				className="relative grid size-8 shrink-0 place-items-center"
				aria-hidden="true"
			>
				<img
					src="/images/agent567-app-icon.png"
					alt=""
					width="32"
					height="32"
					className="block size-full object-contain"
				/>
			</span>
			<span className="grid leading-[1.05]">
				<strong className="font-display text-[1.02rem] font-semibold">567 Agent</strong>
				<small className="mt-[0.18rem] hidden font-mono text-[0.58rem] font-medium tracking-[0.12em] text-fd-muted-foreground uppercase md:block">
					{text.documentation}
				</small>
			</span>
		</span>
	);
}
