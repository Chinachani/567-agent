import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useState } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import { designSystemCategoryLabel, designSystemTagline } from "../design-systems/labels";
import { parsePreviewTokens } from "../design-systems/preview-tokens";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";
import { PluginPortal } from "../plugin-portal";
import { DesignSystemDemo, designSystemDemoHtml } from "./DesignSystemDemo";

interface DesignSystemDetailDialogProps {
	system: DesignSystem;
	busy: boolean;
	/** 右下角「使用这套风格」：由调用方接管后续流程（问项目名 → 建项目）。 */
	onUse(system: DesignSystem): void;
	onClose(): void;
}

/** 详情里的配色条按这个顺序取色，缺哪个跳过哪个。 */
const PALETTE_KEYS = ["primary", "accent", "surface", "surface-raised", "surface-foreground", "muted", "danger"];

/**
 * 一套设计体系的详情 Dialog：大图 demo 自动滚动预览 + 配色 + 元信息，
 * 右下角「使用」进新建流程；demo 可在应用内展开为全屏预览。
 */
export function DesignSystemDetailDialog({ system, busy, onUse, onClose }: DesignSystemDetailDialogProps) {
	const { t, locale } = useTranslation();
	const [expandedPreview, setExpandedPreview] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const demoHtml = designSystemDemoHtml(system);
	const hasDemo = demoHtml !== null;
	const palette = useMemo(() => {
		const { colors } = parsePreviewTokens(system.themeCss);
		return PALETTE_KEYS.map((key) => ({ key, value: colors[key] })).filter(
			(entry): entry is { key: string; value: string } => Boolean(entry.value),
		);
	}, [system.themeCss]);
	// tagline 有译文时 blurb 是补充信息;两者相同就没必要念两遍。
	const tagline = designSystemTagline(system, locale, t);
	const blurb = system.blurb !== tagline ? system.blurb : null;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			if (expandedPreview) setExpandedPreview(false);
			else onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [expandedPreview, onClose]);

	const onOpenSource = (): void => {
		if (!system.source) return;
		setActionError(null);
		void getPluginCtx()
			.ui.openExternal(system.source)
			.catch(() => setActionError(t("gallery.detail.source.failed")));
	};

	return (
		<PluginPortal>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop */}
			<div
				className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 px-6 py-8 backdrop-blur-[2px]"
				onClick={onClose}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps backdrop clicks off the panel */}
				<div
					role="dialog"
					aria-label={t("gallery.detail.aria", { name: system.name })}
					className="flex max-h-[min(80vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
					onClick={(event) => event.stopPropagation()}
				>
					<div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 pb-3 pt-4">
						<span
							title={t(system.vibe === "dark" ? "ds.vibe.dark" : "ds.vibe.light")}
							className={`size-2.5 shrink-0 rounded-full border ${
								system.vibe === "dark" ? "border-zinc-500 bg-zinc-900" : "border-zinc-300 bg-zinc-50"
							}`}
						/>
						<h2 className="min-w-0 truncate text-base font-semibold text-foreground">{system.name}</h2>
						<span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
							{designSystemCategoryLabel(system, t)}
						</span>
						<div className="flex-1" />
						<button
							type="button"
							title={t("ds.close")}
							aria-label={t("ds.close")}
							onClick={onClose}
							className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<svg
								viewBox="0 0 24 24"
								className="size-4"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								aria-hidden
							>
								<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
							</svg>
						</button>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						{/* 大图预览:有 demo 就常开自动滚动,让这页一直「活着」;没有就用 token 色板。 */}
						{hasDemo ? (
							<DesignSystemDemo
								system={system}
								active
								className="aspect-[16/10] rounded-xl border border-border"
							/>
						) : (
							<DesignSystemPreview system={system} className="aspect-[16/10]" />
						)}
						{actionError ? (
							<p
								role="alert"
								className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
							>
								{actionError}
							</p>
						) : null}

						<p className="mt-4 text-sm leading-relaxed text-foreground">{tagline}</p>
						{blurb ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{blurb}</p> : null}

						{palette.length > 0 ? (
							<div className="mt-4">
								<h3 className="text-xs font-medium text-muted-foreground">{t("gallery.detail.palette")}</h3>
								<div className="mt-2 flex flex-wrap gap-2">
									{palette.map((entry) => (
										<span
											key={entry.key}
											title={`${entry.key}: ${entry.value}`}
											className="size-7 rounded-lg border border-border shadow-sm"
											style={{ backgroundColor: entry.value }}
										/>
									))}
								</div>
							</div>
						) : null}

						<dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
							<div className="flex items-center gap-1.5">
								<dt>{t("gallery.detail.resources")}</dt>
								<dd className="text-foreground">{system.resources.length}</dd>
							</div>
							<div className="flex items-center gap-1.5">
								<dt>{t("gallery.detail.license")}</dt>
								<dd className="text-foreground">{system.license ?? "MIT"}</dd>
							</div>
							{system.source ? (
								<button
									type="button"
									onClick={onOpenSource}
									className="flex items-center gap-1 text-primary hover:underline"
								>
									{t("gallery.detail.source")}
									<svg
										viewBox="0 0 24 24"
										className="size-3"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										aria-hidden
									>
										<path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								</button>
							) : null}
						</dl>
					</div>

					<div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
						<div className="flex-1" />
						{hasDemo ? (
							<button
								type="button"
								onClick={() => setExpandedPreview(true)}
								className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
							>
								{t("gallery.detail.expandDemo")}
							</button>
						) : null}
						<button
							type="button"
							disabled={busy}
							onClick={() => onUse(system)}
							className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
						>
							{t("gallery.detail.use", { name: system.name })}
						</button>
					</div>
				</div>
			</div>
			{expandedPreview && demoHtml ? (
				<div
					className="fixed inset-0 z-[1100] flex flex-col bg-background"
					role="dialog"
					aria-modal="true"
					aria-label={t("gallery.detail.demoPreview", { name: system.name })}
				>
					<div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
						<h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
							{t("gallery.detail.demoPreview", { name: system.name })}
						</h2>
						<button
							type="button"
							autoFocus
							onClick={() => setExpandedPreview(false)}
							className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
						>
							{t("gallery.detail.closePreview")}
						</button>
					</div>
					<iframe
						title={t("gallery.detail.demoPreview", { name: system.name })}
						sandbox=""
						srcDoc={demoHtml}
						className="min-h-0 flex-1 border-0 bg-white"
					/>
				</div>
			) : null}
		</PluginPortal>
	);
}
