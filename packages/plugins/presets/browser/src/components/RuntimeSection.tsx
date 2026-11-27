import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { MINIMUM_AGENT_BROWSER_VERSION, type RuntimeStatus } from "../runtime/runtime-controller";

export interface RuntimeSectionProps {
	status: RuntimeStatus;
	onInstallRuntime: () => void;
	onInstallBrowser: () => void;
	onRecheck: () => void;
}

function statusKey(status: RuntimeStatus): string {
	switch (status.phase) {
		case "checking":
			return "console.status.checking";
		case "installing-runtime":
		case "installing-browser":
			return "console.status.installing";
		case "ready":
			return "console.status.ready";
		case "error":
			return "console.status.failed";
		case "outdated":
			return "console.status.outdated";
		case "browser-missing":
			return "console.status.browserMissing";
		default:
			return "console.status.missing";
	}
}

function badgeClasses(status: RuntimeStatus): { pill: string; dot: string } {
	if (status.phase === "ready") {
		return { pill: "bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-500" };
	}
	if (status.phase === "error") {
		return { pill: "bg-destructive/15 text-destructive", dot: "bg-destructive" };
	}
	if (
		status.phase === "outdated" ||
		status.phase === "browser-missing" ||
		status.phase.startsWith("installing-") ||
		status.phase === "checking"
	) {
		return { pill: "bg-amber-500/15 text-amber-400", dot: "bg-amber-500" };
	}
	return { pill: "bg-accent/60 text-muted-foreground", dot: "bg-muted-foreground" };
}

/**
 * 次级运行时状态与安装向导。
 *
 * 安装分两步且第二步**不自动执行**：`agent-browser install` 会下载几百 MB 的
 * Chrome for Testing，而多数用户机器上已经有 Chrome 可以直接复用。第一步的输出里
 * 能读出本机有没有 Chrome，读得出来就据此决定是否提示第二步，读不出来就把选择交给用户。
 */
export function RuntimeSection({
	status,
	onInstallRuntime,
	onInstallBrowser,
	onRecheck,
}: RuntimeSectionProps): JSX.Element {
	const { t } = useTranslation();
	const busy = status.phase.startsWith("installing-") || status.phase === "checking";
	const showBrowserStep = status.phase === "browser-missing";
	const pulsing = status.phase.startsWith("installing-") || status.phase === "checking";
	const badge = badgeClasses(status);

	const hint = ((): string | null => {
		if (status.phase === "missing" || status.phase === "error") return t("console.installHint");
		if (status.phase === "outdated") {
			return t("console.outdatedHint", {
				found: status.version ?? "?",
				required: MINIMUM_AGENT_BROWSER_VERSION,
			});
		}
		if (showBrowserStep) return t("console.chromeMissing");
		if (status.phase === "ready") return t("console.readyHint");
		return null;
	})();

	return (
		<section className="flex flex-col" data-browser-runtime="">
			<h2 className="browser-section-title mb-1">{t("runtime.sectionLabel")}</h2>
			<p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("runtime.subtitle")}</p>
			<div className="browser-card flex flex-col gap-2.5 px-4 py-3">
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
					<span
						className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.pill}`}
					>
						<span
							className={`browser-dot ${badge.dot}${pulsing ? " browser-pulse" : ""}`}
							aria-hidden="true"
						/>
						<span>{t(statusKey(status))}</span>
					</span>
					{status.version ? (
						<code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
							agent-browser {status.version}
						</code>
					) : null}

					<div className="ms-auto flex flex-wrap items-center gap-2">
						{status.phase === "missing" ? (
							<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
								{t("console.install")}
							</button>
						) : null}
						{status.phase === "error" ? (
							<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
								{t("console.retry")}
							</button>
						) : null}
						{status.phase === "outdated" ? (
							<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
								{t("console.upgrade")}
							</button>
						) : null}
						{showBrowserStep ? (
							<button type="button" className="browser-button" onClick={onInstallBrowser} disabled={busy}>
								{t("console.install")}
							</button>
						) : null}
						<button type="button" className="browser-button-ghost" onClick={onRecheck} disabled={busy}>
							{t("console.recheck")}
						</button>
					</div>
				</div>

				{hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
				{status.message ? <p className="text-xs text-destructive">{status.message}</p> : null}
				{status.phase.startsWith("installing-") || status.phase === "error" ? (
					<pre className="browser-output" aria-label={t("console.status.installing")}>
						{status.recentOutput}
					</pre>
				) : null}
			</div>
		</section>
	);
}
