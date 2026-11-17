import { Button } from "@shared/components/ui/button";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Compatibility resolver only: the retired team workspace is no longer mounted. */
export function LegacyTeamHistoryRedirect(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const { teamId, sessionId, memberId } = useParams({ strict: false });
	const navigate = useNavigate();
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		setFailed(false);
		void waitForCommittedPaint().then(async () => {
			if (!active) return;
			try {
				const sessions = teamId ? await window.agent567.agentTeams.listSessions(teamId) : [];
				if (!active) return;
				const reference = sessionId ? sessions.find((session) => session.id === sessionId) : sessions[0];
				if (!reference) throw new Error("No archived conversation");
				let path: string | undefined = reference.coordinationSessionPath;
				if (memberId) {
					const snapshot = await window.agent567.agentTeams.getSession(reference);
					if (!active) return;
					path = snapshot.session.memberRuntime[memberId]?.sessionPath;
				}
				if (!path) throw new Error("Archive has no ordinary conversation path");
				void navigate({
					to: "/viewer/$path",
					params: { path: encodeURIComponent(path) },
					search: { origin: "team", teamSession: reference.id },
					replace: true,
				});
			} catch {
				if (active) setFailed(true);
			}
		});
		return () => {
			active = false;
		};
	}, [attempt, memberId, navigate, sessionId, teamId]);
	return (
		<div className="flex flex-col items-start gap-3 p-8 text-[13px] text-muted-foreground">
			<p role={failed ? "alert" : "status"}>{t(failed ? "experts.archiveUnavailable" : "experts.openingArchive")}</p>
			{failed && (
				<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
					{t("chat.retry")}
				</Button>
			)}
			<Button variant="ghost" onClick={() => void navigate({ to: "/agents", search: { tab: "collaboration" } })}>
				{t("experts.goCollaboration")}
			</Button>
		</div>
	);
}
