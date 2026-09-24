import { useActiveConversation, useActivityTab, useTranslation, type PluginContext } from "@vetta-org/plugin-sdk";
import { useEffect } from "react";
import { lazy, Suspense, useLayoutEffect, useMemo, useState, type ComponentType } from "react";
import { installBridgeFromPluginContext } from "./vettaCowartBridge";
import { getPluginContext } from "./pluginContext";

/**
 * Lazy-load the full tldraw canvas. Eager import of App.jsx (~2MB + tldraw)
 * was pulling the whole graph into the MF expose entry and often made
 * loadPlugin fail — activity tab never registered.
 */
const CowartApp = lazy(() =>
	import("../canvas/App.jsx").then((mod) => ({ default: mod.default as ComponentType })),
);

/**
 * Full Cowart tldraw canvas in the activity tab.
 * Codex widget host → Vetta: bridge via installCowartVettaBridge (ctx.fs + sendPrompt).
 */
export function CanvasPanel() {
	const { t } = useTranslation();
	const activityTab = useActivityTab();
	const convo = useActiveConversation();
	const ctx = getPluginContext();
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [fallbackDir, setFallbackDir] = useState<string | null>(null);

	useEffect(() => {
		if (activityTab?.cwd || convo?.cwd) return;
		let cancelled = false;
		if (
			typeof window !== "undefined" &&
			(window as unknown as { vetta?: { config?: { get?: () => Promise<{ defaultConversationCwd?: string; workspacePath?: string }> } } }).vetta?.config?.get
		) {
			(window as unknown as { vetta: { config: { get: () => Promise<{ defaultConversationCwd?: string; workspacePath?: string }> } } }).vetta.config.get()
				.then((cfg) => {
					if (!cancelled && (cfg?.defaultConversationCwd || cfg?.workspacePath)) {
						setFallbackDir(cfg.defaultConversationCwd || cfg.workspacePath || null);
					}
				})
				.catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, [activityTab?.cwd, convo?.cwd]);

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

	// useLayoutEffect: install bridge before child App effects call loadCowartCanvasState.
	useLayoutEffect(() => {
		if (!ctx || !projectDir) {
			setReady(false);
			return;
		}
		setError(null);
		let dispose: (() => void) | undefined;
		try {
			dispose = installBridgeFromPluginContext(ctx, projectDir);
			setReady(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setReady(false);
		}
		return () => {
			dispose?.();
			// Keep ready true during Strict Mode remount gap — bridge is ref-counted.
		};
	}, [ctx, projectDir]);

	if (!projectDir) {
		return (
			<div className="cowart-vetta-panel">
				<h2>{t("panel.title")}</h2>
				<p className="cowart-vetta-muted">{t("panel.noCwd")}</p>
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
				<CowartApp />
			</Suspense>
		</div>
	);
}

// Satisfy type import used by bridge consumers
export type { PluginContext };
