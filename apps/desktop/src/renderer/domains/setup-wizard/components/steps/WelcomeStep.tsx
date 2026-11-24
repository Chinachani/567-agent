import { useNewChatNavigation } from "@domains/project/hooks/useNewChatNavigation";
import { BrandIcon } from "@shared/components/BrandIcon";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FeatureGuide } from "../FeatureGuide";

const FIRST_TASK_STEPS = [
	{ num: "01", key: "pickStart" },
	{ num: "02", key: "connectModel" },
	{ num: "03", key: "reviewOutput" },
] as const;

export function WelcomeStep({ onComplete }: { onComplete?: () => void }): JSX.Element {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const openNewChat = useNewChatNavigation();

	const startFirstChat = () => {
		onComplete?.();
		openNewChat();
	};

	const openModelSettings = () => {
		onComplete?.();
		void navigate({ to: "/settings/$tab", params: { tab: "models" } });
	};

	return (
		<div className="flex w-full flex-col items-center gap-5 text-center">
			<div className="flex items-center justify-center">
				<BrandIcon className="size-12" />
			</div>
			<div>
				<h2 className="text-[20px] font-bold text-foreground">{t("setupWizard.welcome.title")}</h2>
				<p className="mt-2 text-[13px] text-muted-foreground">{t("setupWizard.welcome.subtitle")}</p>
			</div>

			<ol className="w-full space-y-2 rounded-xl border border-border/60 bg-card/50 p-4 text-left">
				{FIRST_TASK_STEPS.map((item) => (
					<li key={item.key} className="flex items-start gap-3 py-1">
						<span className="mt-0.5 font-mono text-[11px] font-semibold text-muted-foreground">{item.num}</span>
						<div className="min-w-0 flex-1">
							<p className="text-[13px] font-medium text-foreground">
								{t(`setupWizard.welcome.steps.${item.key}.title`)}
							</p>
							<p className="mt-0.5 text-[12px] text-muted-foreground">
								{t(`setupWizard.welcome.steps.${item.key}.desc`)}
							</p>
						</div>
					</li>
				))}
			</ol>

			<div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
				<button
					type="button"
					onClick={startFirstChat}
					className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
				>
					<span className="icon-[solar--chat-round-dots-linear] mt-0.5 h-4 w-4 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						<span className="block text-[13px] font-medium text-foreground">
							{t("setupWizard.welcome.actions.startChatTitle")}
						</span>
						<span className="mt-0.5 block text-[12px] text-muted-foreground">
							{t("setupWizard.welcome.actions.startChatDesc")}
						</span>
					</span>
				</button>

				<button
					type="button"
					onClick={openModelSettings}
					className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
				>
					<span className="icon-[solar--tuning-2-linear] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1">
						<span className="block text-[13px] font-medium text-foreground">
							{t("setupWizard.welcome.actions.modelsTitle")}
						</span>
						<span className="mt-0.5 block text-[12px] text-muted-foreground">
							{t("setupWizard.welcome.actions.modelsDesc")}
						</span>
					</span>
				</button>
			</div>

			<div className="flex flex-wrap items-center justify-center gap-3 text-[12px] text-muted-foreground">
				<span>{t("setupWizard.welcome.replayHint")}</span>
				<FeatureGuide />
			</div>
		</div>
	);
}
