import type { JSX, ReactNode } from "react";
import { Button } from "@vetta-org/ui";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export type EnvironmentRuntimeKindView = "node" | "python";

export interface EnvironmentRuntimeStatusView {
	readonly managedVersion?: string;
	readonly ready: boolean;
	readonly supported: boolean;
	readonly repairRequiresRestart?: boolean;
}

export interface EnvironmentSettingsViewLabels {
	readonly description: string;
	readonly fetch: string;
	readonly fetchAgain: string;
	readonly fetching: string;
	readonly loading: string;
	readonly notReady: string;
	readonly npmRegistry: string;
	readonly npmRegistryDescription: string;
	readonly pipIndex: string;
	readonly pipIndexDescription: string;
	readonly platformNotSupported: string;
	readonly ready: string;
	readonly runtimeDescriptions: Record<EnvironmentRuntimeKindView, string>;
	readonly sections: {
		readonly mirrors: string;
		readonly runtime: string;
	};
	readonly title: string;
	readonly progress: string;
	readonly logs: string;
	readonly restartAndRepair: string;
	readonly repairRequiresRestart: string;
	readonly repairRestartDescription: string;
}

export interface EnvironmentInstallProgressView {
	readonly type: EnvironmentRuntimeKindView;
	readonly phase: string;
	readonly downloadedBytes?: number;
	readonly totalBytes?: number;
	readonly message: string;
}

export interface EnvironmentSettingsViewProps {
	readonly busy: EnvironmentRuntimeKindView | null;
	readonly error: string | null;
	readonly progress: EnvironmentInstallProgressView | null;
	readonly logs: readonly string[];
	readonly headerAction?: ReactNode;
	readonly labels: EnvironmentSettingsViewLabels;
	readonly mirrors?: {
		readonly npmRegistry: string;
		readonly pipIndexUrl: string;
	} | null;
	readonly onReinstall: (kind: EnvironmentRuntimeKindView) => void;
	readonly runtimeSection: SettingSectionMeta;
	readonly mirrorsSection: SettingSectionMeta;
	readonly status: {
		readonly node: EnvironmentRuntimeStatusView;
		readonly python: EnvironmentRuntimeStatusView;
	} | null;
}

const RUNTIME_META: Record<EnvironmentRuntimeKindView, { icon: string; name: string }> = {
	node: { icon: "icon-[mdi--nodejs]", name: "Node.js" },
	python: { icon: "icon-[mdi--language-python]", name: "Python" },
};

function RuntimeCard({
	busy,
	disabled,
	kind,
	labels,
	onReinstall,
	status,
}: {
	busy: boolean;
	disabled: boolean;
	kind: EnvironmentRuntimeKindView;
	labels: EnvironmentSettingsViewLabels;
	onReinstall: () => void;
	status: EnvironmentRuntimeStatusView;
}): JSX.Element {
	const meta = RUNTIME_META[kind];
	const stateText = !status.supported
		? labels.platformNotSupported
		: busy
			? labels.fetching
			: status.repairRequiresRestart
				? labels.repairRequiresRestart
				: status.ready
					? `${labels.ready} · ${status.managedVersion}`
					: labels.notReady;
	const healthy = status.ready && !status.repairRequiresRestart && !busy;
	const stateClass = healthy ? "text-emerald-400" : status.supported ? "text-amber-400" : "text-muted-foreground";

	return (
		<SettingRow
			title={meta.name}
			description={status.repairRequiresRestart ? labels.repairRestartDescription : labels.runtimeDescriptions[kind]}
			border={kind === "node"}
		>
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1.5">
					<span
						className={
							healthy
								? "icon-[mdi--check-circle] h-4 w-4 text-emerald-400"
								: "icon-[mdi--alert-circle-outline] h-4 w-4 text-amber-400"
						}
					/>
					<span role="status" className={`text-[12px] ${stateClass}`}>
						{stateText}
					</span>
				</div>
				{status.supported && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={onReinstall}
						className="gap-1.5 text-[12px]"
					>
						{busy ? (
							<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
						) : (
							<span
								className={
									status.repairRequiresRestart
										? "icon-[solar--restart-linear] h-3.5 w-3.5 text-muted-foreground"
										: "icon-[mdi--download-outline] h-3.5 w-3.5 text-muted-foreground"
								}
							/>
						)}
						{status.repairRequiresRestart
							? labels.restartAndRepair
							: status.ready
								? labels.fetchAgain
								: labels.fetch}
					</Button>
				)}
			</div>
		</SettingRow>
	);
}

export function EnvironmentSettingsView({
	busy,
	error,
	progress,
	logs,
	headerAction,
	labels,
	mirrors,
	mirrorsSection,
	onReinstall,
	runtimeSection,
	status,
}: EnvironmentSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[800px] px-5 pt-6 sm:px-8 pb-4">
			<div className="mb-6">
				<div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-[24px] font-semibold tracking-tight text-foreground">{labels.title}</h1>
					{headerAction}
				</div>
				<p className="text-[13px] text-muted-foreground">{labels.description}</p>
			</div>

			{error && (
				<div
					role="alert"
					className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-[12px] text-destructive"
				>
					{error}
				</div>
			)}

			{busy && progress?.type === busy ? (
				<div className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
					<div className="flex items-center justify-between gap-3 text-[12px] text-foreground">
						<span>
							{labels.progress}: {progress.message}
						</span>
						{progress.totalBytes ? (
							<span className="shrink-0 text-muted-foreground">
								{Math.min(100, Math.round(((progress.downloadedBytes ?? 0) / progress.totalBytes) * 100))}%
							</span>
						) : null}
					</div>
					{progress.totalBytes ? (
						<progress
							className="mt-2 h-1.5 w-full overflow-hidden rounded-full accent-primary"
							max={progress.totalBytes}
							value={Math.min(progress.downloadedBytes ?? 0, progress.totalBytes)}
						/>
					) : (
						<div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-muted" />
					)}
					<details className="mt-2 text-[11px] text-muted-foreground">
						<summary className="cursor-pointer">{labels.logs}</summary>
						<div className="mt-2 max-h-32 overflow-auto rounded bg-muted/60 p-2 font-mono">
							{logs.map((line, index) => (
								<div key={`${index}-${line}`}>{line}</div>
							))}
						</div>
					</details>
				</div>
			) : null}

			<SettingSection title={labels.sections.runtime} section={runtimeSection}>
				{status ? (
					<>
						<RuntimeCard
							kind="node"
							status={status.node}
							busy={busy === "node"}
							disabled={busy !== null}
							labels={labels}
							onReinstall={() => onReinstall("node")}
						/>
						<RuntimeCard
							kind="python"
							status={status.python}
							busy={busy === "python"}
							disabled={busy !== null}
							labels={labels}
							onReinstall={() => onReinstall("python")}
						/>
					</>
				) : (
					<div className="px-5 py-4 text-[12px] text-muted-foreground">{labels.loading}</div>
				)}
			</SettingSection>

			<SettingSection title={labels.sections.mirrors} section={mirrorsSection}>
				<SettingRow title={labels.npmRegistry} description={labels.npmRegistryDescription} border>
					<span className="text-[12px] text-muted-foreground">{mirrors?.npmRegistry ?? "—"}</span>
				</SettingRow>
				<SettingRow title={labels.pipIndex} description={labels.pipIndexDescription} border={false}>
					<span className="text-[12px] text-muted-foreground">{mirrors?.pipIndexUrl ?? "—"}</span>
				</SettingRow>
			</SettingSection>
		</div>
	);
}
