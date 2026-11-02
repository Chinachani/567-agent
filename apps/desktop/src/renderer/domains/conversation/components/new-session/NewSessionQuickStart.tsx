import { useNavigate } from "@tanstack/react-router";
import { activeComposerCommandsAtom } from "@shared/store/atoms";
import { NewSessionQuickStartView } from "@vetta-org/theme-ui/chat";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

/** Reuses the mounted composer; opening a capability never rewrites the draft. */
export function NewSessionQuickStart({ onOpenTeams }: { onOpenTeams: () => void }) {
	const { t } = useTranslation("chat");
	const commands = useAtomValue(activeComposerCommandsAtom);
	const navigate = useNavigate();
	return (
		<NewSessionQuickStartView
			items={[
				{ label: t("newSession.quickStart.teams"), onSelect: onOpenTeams },
				{
					label: t("newSession.quickStart.commands"),
					disabled: !commands?.openCommands,
					onSelect: () => commands?.openCommands?.(),
				},
				{
					label: t("newSession.quickStart.references"),
					disabled: !commands?.openReferences,
					onSelect: () => commands?.openReferences?.(),
				},
				{
					label: t("newSession.quickStart.pairing"),
					onSelect: () => void navigate({ to: "/settings/$tab", params: { tab: "remote" } }),
				},
			]}
		/>
	);
}
