import { FeatureGuideContent } from "../FeatureGuide";
import { BotAvatar } from "@shared/components/BotAvatar";
import { useTranslation } from "react-i18next";

export function WelcomeStep(): JSX.Element {
	const { t } = useTranslation("common");

	return (
		<div className="flex w-full flex-col items-center gap-5 text-center">
			<div className="flex items-center justify-center">
				<BotAvatar size="lg" autoplay />
			</div>
			<div>
				<h2 className="text-[20px] font-bold text-foreground">{t("setupWizard.welcome.title")}</h2>
				<p className="mt-2 text-[13px] text-muted-foreground">{t("setupWizard.welcome.subtitle")}</p>
			</div>

			<div className="w-full">
				<FeatureGuideContent />
			</div>
		</div>
	);
}
