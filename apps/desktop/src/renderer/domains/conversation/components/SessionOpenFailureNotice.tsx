import { Button } from "@shared/components/ui/button";
import { openSessionFnRef, pendingSessionOpenAtom, readSessionManagerFn } from "@shared/store/atoms";
import { getDefaultStore, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { ChatError } from "./chat-view/DefaultChatView";

/** Failed restore keeps a file identity, never a fabricated interactive Runtime. */
export function SessionOpenFailureNotice(): JSX.Element | null {
	const pending = useAtomValue(pendingSessionOpenAtom);
	const { t } = useTranslation("chat");
	if (!pending) return null;
	if (!pending.error) {
		return (
			<div className="flex shrink-0 items-center gap-2 px-4 py-2 text-[12px] text-muted-foreground" role="status">
				<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				{t("session.openFailure.opening")}
			</div>
		);
	}
	const retry = (): void => {
		const current = getDefaultStore().get(pendingSessionOpenAtom);
		if (!current?.error) return;
		void readSessionManagerFn(openSessionFnRef, "openSession")?.(current.cwd, current.sessionPath).catch(
			(error: unknown) => console.error("[SessionOpenFailureNotice] retry failed", error),
		);
	};
	return (
		<ChatError>
			<div className="flex items-start gap-3">
				<span className="icon-[solar--danger-triangle-linear] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<p className="font-medium">{t("session.openFailure.title")}</p>
					<p className="mt-1 text-muted-foreground">{t("session.openFailure.description")}</p>
					<details className="mt-2 text-muted-foreground">
						<summary className="cursor-pointer">{t("session.openFailure.details")}</summary>
						<p className="mt-1 whitespace-pre-wrap break-words">{pending.error}</p>
					</details>
				</div>
				<Button size="xs" variant="outline" className="shrink-0" onClick={retry}>
					{t("session.openFailure.retry")}
				</Button>
			</div>
		</ChatError>
	);
}
