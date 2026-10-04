import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import { getPluginContext } from "./pluginContext";
import { getSessionCanvasDir } from "./canvas-session-path";

const TAB_ID = "canvas";

function getWorkspaceRoots(): string[] {
	const ctx = getPluginContext();
	try {
		return (ctx?.fileExplorer?.getWorkspaceRoots() ?? [])
			.map((root) => root.path?.trim())
			.filter((path): path is string => Boolean(path));
	} catch {
		return [];
	}
}

export function CanvasWorkspaceLauncher() {
	const { t } = useTranslation();
	const conversation = useActiveConversation();
	const attemptRef = useRef(-1);
	const [attempt, setAttempt] = useState(0);
	const [status, setStatus] = useState<"opening" | "error">("opening");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const ctx = getPluginContext();
		if (!ctx || attemptRef.current === attempt) return;
		attemptRef.current = attempt;

		const openCanvasSession = async () => {
			try {
				let cwd = conversation?.cwd?.trim() || getWorkspaceRoots()[0] || "";
				if (!cwd && ctx.official?.projects?.list) {
					cwd = (await ctx.official.projects.list()).workspacePath?.trim() || "";
				}
				if (!cwd) throw new Error(t("launcher.noWorkspace"));

				const session = await ctx.conversation.createSession(cwd, { navigate: false });
				const sessionCwd = session.cwd?.trim() || cwd;
				if (!session.sessionPath) throw new Error(t("launcher.noSessionPath"));

				// Creating the directory marks this as a new, session-owned canvas while
				// leaving any legacy project/canvas data untouched.
				await ctx.fs.createDirectory(getSessionCanvasDir(sessionCwd, session.sessionPath));
				if (!ctx.official?.sessions?.open) throw new Error(t("launcher.navigationUnavailable"));
				await ctx.official.sessions.open({ cwd: sessionCwd, sessionPath: session.sessionPath });
				ctx.ui.openActivityTab(TAB_ID, { cwd: sessionCwd, width: "max" });
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setStatus("error");
			}
		};

		void openCanvasSession();
	}, [attempt, conversation?.cwd, t]);

	return (
		<div className="cowart-vetta-panel" role="status" aria-live="polite">
			<h2>{t("panel.title")}</h2>
			{status === "opening" ? (
				<p className="cowart-vetta-muted">{t("launcher.opening")}</p>
			) : (
				<>
					<p className="cowart-vetta-muted">{error}</p>
					<button
						type="button"
						onClick={() => {
							setError(null);
							setStatus("opening");
							setAttempt((value) => value + 1);
						}}
					>
						{t("launcher.retry")}
					</button>
				</>
			)}
		</div>
	);
}
