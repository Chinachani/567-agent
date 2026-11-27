import { defaultImConversationCwdAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@vetta-org/ui";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "./formatRelativeTime";

type ClawSessions = Awaited<ReturnType<typeof window.agent567.session.listSessions>>;

export function ClawConversationList({ onOpen }: { onOpen: () => void }): JSX.Element {
	const { t } = useTranslation("message");
	const cwd = useAtomValue(defaultImConversationCwdAtom);
	const navigate = useNavigate();
	const [outcome, setOutcome] = useState<{ cwd: string; sessions: ClawSessions | null }>();
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		if (!cwd) return;
		let generation = 0;
		const load = async () => {
			const request = ++generation;
			let sessions: ClawSessions | null;
			try {
				sessions = await window.agent567.session.listSessions(cwd);
			} catch {
				sessions = null;
			}
			if (request === generation) setOutcome({ cwd, sessions });
		};
		void load();
		const unsubscribe = window.agent567.im.onSessionChanged(() => void load());
		return () => {
			generation++;
			unsubscribe();
		};
	}, [cwd, retry]);
	const result = outcome?.cwd === cwd ? outcome : undefined;
	const sessions = (result?.sessions ?? [])
		.filter((session) => session.access.readHistory)
		.sort((left, right) => right.modifiedAt - left.modifiedAt);
	const isError = result?.sessions === null;
	const loading = Boolean(cwd) && !result;
	if (loading || isError || sessions.length === 0) {
		return (
			<div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
				<p role="status">{t(isError ? "claw.error" : loading ? "claw.loading" : "claw.empty")}</p>
				{isError && <Button variant="ghost" size="sm" onClick={() => { setOutcome(undefined); setRetry((current) => current + 1); }}>{t("claw.retry")}</Button>}
			</div>
		);
	}
	return (
		<ul className="space-y-1 p-2">
			{sessions.map((session) => (
				<li key={session.path}>
					<button
						type="button"
						className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:outline focus-visible:outline-ring"
						onClick={() => {
							void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(session.path) } });
							onOpen();
						}}
					>
						<span aria-hidden="true" className="icon-[solar--chat-line-linear] size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-sm">{session.name?.trim() || session.firstMessage || t("results.unnamed")}</span>
						<span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(session.modifiedAt, t)}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
