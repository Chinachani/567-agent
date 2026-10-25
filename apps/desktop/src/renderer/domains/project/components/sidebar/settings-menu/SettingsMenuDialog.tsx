import { Button } from "@shared/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { useRef, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { SettingsMenuAccountSection } from "./SettingsMenuAccountSection";
import { SettingsMenuQuotaSection } from "./SettingsMenuQuotaSection";
import { SettingsMenuThemeSection } from "./SettingsMenuThemeSection";
import type { SettingsMenuModel } from "./types";

export function SettingsMenuDialog({
	model,
	onCloseAutoFocus,
}: {
	model: SettingsMenuModel;
	onCloseAutoFocus: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}): JSX.Element {
	const { t } = useTranslation("settings");
	const content = useRef<HTMLDivElement>(null);
	const { t: common } = useTranslation("common");
	return (
		<Dialog open={model.open} onOpenChange={model.actions.setOpen}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				ref={content}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.querySelector<HTMLButtonElement>("button")?.focus();
				}}
				onCloseAutoFocus={onCloseAutoFocus}
			>
				<DialogHeader className="pr-8">
					<DialogTitle>{t("sidebarAccount.settings")}</DialogTitle>
				</DialogHeader>
				<SettingsMenuThemeSection model={model} />
				<SettingsMenuQuotaSection model={model} />
				{model.cloudEnabled && model.user && <SettingsMenuAccountSection model={model} />}
				<Button variant="outline" className="w-full justify-start gap-2" onClick={model.actions.openSettings}>
					<span aria-hidden="true" className="icon-[solar--settings-linear] h-4 w-4" />
					{t("sidebarAccount.allSettings")}
				</Button>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute right-2 top-2"
						aria-label={common("actions.close")}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-4 w-4" />
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
