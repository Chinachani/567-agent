import { activeSessionAtom, defaultConversationCwdAtom } from "@shared/store/atoms";
import { Button } from "@shared/components/ui/button";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function SessionMigrationSettings(): JSX.Element {
	const { t } = useTranslation("settings");
	const cwd = useAtomValue(defaultConversationCwdAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const [passphrase, setPassphrase] = useState("");
	const [sessions, setSessions] = useState<Array<{ id: string; path: string; cwd: string }>>([]);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const activePath = activeSession?.sessionPath ?? "";

	const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
	const selectedActiveSession = useMemo(() => sessions.find((session) => session.path === activePath), [activePath, sessions]);

	const loadSessions = useCallback(async () => {
		if (!cwd) return;
		try {
			const projects = await window.agent567.session.listProjects();
			const cwds = Array.from(new Set([cwd, ...projects.map((project) => project.cwd)]));
			const groups = await Promise.all(cwds.map(async (sessionCwd) =>
				(await window.agent567.session.listSessions(sessionCwd))
					.filter((session) => session.access.readHistory)
					.map(({ id, path }) => ({ id, path, cwd: sessionCwd })),
			));
			setSessions(groups.flat());
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		}
	}, [cwd]);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions]);

	const exportArchive = async (selected: Array<{ id: string; cwd: string }>) => {
		if (passphrase.length < 8 || passphrase.length > 128) {
			setMessage(t("migrationPasswordLength"));
			return;
		}
		setBusy(true);
		setMessage("");
		try {
			const scopes = Array.from(new Set(selected.map((session) => session.cwd))).map((scopeCwd) => ({
				cwd: scopeCwd,
				sessionIds: selected.filter((session) => session.cwd === scopeCwd).map((session) => session.id),
			}));
			const result = await window.agent567.session.exportMigrationArchive(selected.map((session) => session.id), passphrase, undefined, scopes);
			if (!result.canceled) setMessage(t("migrationExported", { count: result.sessionCount ?? selected.length }));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const importArchive = async () => {
		if (passphrase.length < 8 || passphrase.length > 128) {
			setMessage(t("migrationPasswordLength"));
			return;
		}
		setBusy(true);
		setMessage("");
		try {
			const result = await window.agent567.session.importMigrationArchive(passphrase);
			if (!result.canceled) {
				setMessage(t("migrationImported", { count: result.importedSessions ?? 0 }));
				await loadSessions();
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="mx-auto -mt-2 mb-6 w-full max-w-[680px] px-8">
			<div className="rounded-xl border border-border bg-card">
				<div className="border-b border-border px-5 py-4">
					<h2 className="text-sm font-semibold text-foreground">{t("migrationTitle")}</h2>
					<p className="mt-1 text-xs text-muted-foreground">{t("migrationDescription")}</p>
				</div>
				<div className="space-y-3 p-5">
					<label className="block text-xs text-muted-foreground" htmlFor="migration-passphrase">
						{t("migrationPassword")}
					</label>
					<input
						id="migration-passphrase"
						type="password"
						autoComplete="new-password"
						value={passphrase}
						onChange={(event) => setPassphrase(event.target.value)}
						maxLength={128}
						className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" disabled={busy || sessionIds.length === 0} onClick={() => void exportArchive(sessions)}>
							{t("migrationExportAll")}
						</Button>
						<Button size="sm" variant="outline" disabled={busy || !selectedActiveSession} onClick={() => selectedActiveSession && void exportArchive([selectedActiveSession])}>
							{t("migrationExportCurrent")}
						</Button>
						<Button size="sm" variant="outline" disabled={busy} onClick={() => void importArchive()}>
							{t("migrationImport")}
						</Button>
					</div>
					{message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
				</div>
			</div>
		</section>
	);
}
