import { useActiveConversation, useActivityTab, useTranslation, type PluginContext } from "@vetta-org/plugin-sdk";
import { useEffect } from "react";
import { lazy, Suspense, useLayoutEffect, useMemo, useState, type ComponentType } from "react";
import { installBridgeFromPluginContext } from "./vettaCowartBridge";
import { getPluginContext } from "./pluginContext";
import { getSessionCanvasDir } from "./canvas-session-path";

/**
 * Lazy-load the full tldraw canvas. Eager import of App.jsx (~2MB + tldraw)
 * was pulling the whole graph into the MF expose entry and often made
 * loadPlugin fail — activity tab never registered.
 */
const CowartApp = lazy(() =>
	import("../canvas/App.jsx").then((mod) => ({ default: mod.default as ComponentType })),
);

function joinPath(root: string, ...parts: string[]): string {
	const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	return [root.replace(/[/\\]+$/, ""), ...parts.map((part) => part.replace(/^[/\\]+|[/\\]+$/g, ""))]
		.filter(Boolean)
		.join(sep);
}

/**
 * Full Cowart tldraw canvas in the activity tab.
 * Codex widget host → 567 Agent: bridge via installCowartVettaBridge (ctx.fs + sendPrompt).
 */
export function CanvasPanel() {
	const { t } = useTranslation();
	const activityTab = useActivityTab();
	const convo = useActiveConversation();
	const ctx = getPluginContext();
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [fallbackDir, setFallbackDir] = useState<string | null>(null);
	const [canvasStorage, setCanvasStorage] = useState<{
		projectDir: string;
		sessionPath: string;
		canvasDir: string;
	} | null>(null);

	useEffect(() => {
		if (activityTab?.cwd || convo?.cwd) return;
		let cancelled = false;
		if (ctx?.official?.projects?.list) {
			ctx.official.projects.list()
				.then((res) => {
					if (!cancelled && res?.workspacePath) {
						setFallbackDir(res.workspacePath);
					}
				})
				.catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, [activityTab?.cwd, convo?.cwd, ctx]);

	const projectDir = useMemo(() => {
		if (activityTab?.cwd && activityTab.cwd.trim()) return activityTab.cwd.trim();
		if (convo?.cwd && convo.cwd.trim()) return convo.cwd.trim();
		try {
			const roots = ctx?.fileExplorer?.getWorkspaceRoots();
			if (roots && roots.length > 0 && roots[0]?.path) {
				return roots[0].path;
			}
		} catch {
			// ignore
		}
		return fallbackDir;
	}, [activityTab?.cwd, convo?.cwd, ctx, fallbackDir]);
	const sessionPath = convo?.sessionPath?.trim() || null;

	useEffect(() => {
		if (!ctx || !projectDir || !sessionPath) {
			setCanvasStorage(null);
			return;
		}
		let cancelled = false;
		setError(null);
		setCanvasStorage(null);
		const sessionCanvasDir = getSessionCanvasDir(projectDir, sessionPath);
		const legacyCanvasDir = joinPath(projectDir, "canvas");
		void ctx.fs
			.stat(sessionCanvasDir)
			.then(async (sessionCanvas) => {
				if (cancelled) return;
				if (sessionCanvas) {
					setCanvasStorage({ projectDir, sessionPath, canvasDir: sessionCanvasDir });
					return;
				}
				const legacyCanvas = await ctx.fs.stat(legacyCanvasDir);
				if (!cancelled) {
					setCanvasStorage({ projectDir, sessionPath, canvasDir: legacyCanvas ? legacyCanvasDir : sessionCanvasDir });
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [ctx, projectDir, sessionPath]);
	const canvasDir =
		canvasStorage?.projectDir === projectDir && canvasStorage.sessionPath === sessionPath
			? canvasStorage.canvasDir
			: null;

	// useLayoutEffect: install bridge before child App effects call loadCowartCanvasState.
	useLayoutEffect(() => {
		if (!ctx || !projectDir || !canvasDir || !sessionPath) {
			setReady(false);
			return;
		}
		setError(null);
		let dispose: (() => void) | undefined;
		try {
			dispose = installBridgeFromPluginContext(ctx, projectDir, canvasDir, sessionPath);
			setReady(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setReady(false);
		}
		return () => {
			dispose?.();
			// Keep ready true during Strict Mode remount gap — bridge is ref-counted.
		};
	}, [ctx, projectDir, canvasDir, sessionPath]);

	if (!projectDir) {
		return (
			<div className="cowart-vetta-panel">
				<h2>{t("panel.title")}</h2>
				<p className="cowart-vetta-muted">{t("panel.noCwd")}</p>
			</div>
		);
	}

	if (!sessionPath || !canvasDir) {
		return (
			<div className="cowart-vetta-panel">
				<p className="cowart-vetta-muted">{t("panel.waitingForSession")}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="cowart-vetta-panel">
				<h2>{t("panel.title")}</h2>
				<p className="cowart-vetta-muted">{error}</p>
			</div>
		);
	}

	if (!ready) {
		return (
			<div className="cowart-vetta-panel">
				<p className="cowart-vetta-muted">Loading Cowart…</p>
			</div>
		);
	}

	return (
		<div className="cowart-vetta-canvas-host" data-cowart-canvas-host>
			<Suspense
				fallback={
					<div className="cowart-vetta-panel">
						<p className="cowart-vetta-muted">Loading Cowart…</p>
					</div>
				}
			>
				<CowartApp key={canvasDir} />
			</Suspense>
		</div>
	);
}

// Satisfy type import used by bridge consumers
export type { PluginContext };
