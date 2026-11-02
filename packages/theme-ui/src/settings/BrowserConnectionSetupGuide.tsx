import { useRef, type JSX, type ReactNode } from "react";
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@vetta-org/ui";
import type { BrowserConnectionSettingsModel } from "./BrowserConnectionSettingsView";

function SetupStep({ number, title, children }: { number: number; title: string; children: ReactNode }): JSX.Element {
	return (
		<li className="flex items-start gap-3">
			<span
				aria-hidden="true"
				className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[12px] font-medium text-muted-foreground"
			>
				{number}
			</span>
			<div className="min-w-0 flex-1 space-y-2 pt-0.5">
				<h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
				{children}
			</div>
		</li>
	);
}

/** A local tutorial. It reports only configuration facts and never invents an installation or connection state. */
export function BrowserConnectionSetupGuide({
	model,
	open,
	onOpenChange,
}: {
	model: BrowserConnectionSettingsModel;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	const titleRef = useRef<HTMLHeadingElement>(null);
	const { guideLabels: guide, labels, actions } = model;
	const busy = model.loading || model.saving;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					{labels.setup}
				</Button>
			</DialogTrigger>
			<DialogContent
				className="flex max-h-[85vh] max-w-[min(540px,calc(100%-2rem))] flex-col overflow-hidden"
				showCloseButton={false}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					titleRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle ref={titleRef} tabIndex={-1} className="pr-8 outline-none">
						{guide.title}
					</DialogTitle>
					<DialogDescription>{guide.description}</DialogDescription>
				</DialogHeader>
				<DialogClose asChild>
					<Button variant="ghost" size="icon-sm" className="absolute right-2 top-2" aria-label={guide.close}>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-4" />
					</Button>
				</DialogClose>
				<div
					aria-busy={model.saving}
					className="min-h-0 overflow-y-auto pr-1 text-[12px] leading-relaxed text-muted-foreground"
				>
					<ol className="space-y-5">
						<SetupStep number={1} title={model.preferBundledInstall ? guide.bundleTitle : guide.installTitle}>
							<p>{model.preferBundledInstall ? guide.bundleBody : guide.installBody}</p>
							<p className="font-medium text-foreground">{model.targetSummary}</p>
							{model.preferBundledInstall ? (
								<>
									<Button
										variant="outline"
										size="sm"
										disabled={busy || !model.canInstall || model.conflict}
										onClick={actions.prepareBundle}
									>
										{guide.prepareBundle}
									</Button>
									{model.extensionDirectory && (
										<div className="space-y-2">
											<p className="select-text break-all rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
												{model.extensionDirectory}
											</p>
											<Button variant="ghost" size="sm" onClick={actions.copyDirectory}>
												{model.copiedDirectory ? guide.copiedDirectory : guide.copyDirectory}
											</Button>
										</div>
									)}
								</>
							) : (
								<div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
									<p>
										<strong className="font-medium text-foreground">{guide.chrome}</strong>{" "}
										{guide.chromeInstructions}
									</p>
									<p>
										<strong className="font-medium text-foreground">{guide.edge}</strong>{" "}
										{guide.edgeInstructions}
									</p>
								</div>
							)}
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={busy || !model.canInstall || model.conflict}
									onClick={actions.openStore}
								>
									{guide.openStore}
								</Button>
								<Button variant="ghost" size="sm" onClick={actions.copyStoreLink}>
									{model.copiedStoreLink ? guide.copied : guide.copyLink}
								</Button>
							</div>
							<p className="text-[11px]">{guide.wrongBrowser}</p>
						</SetupStep>
						<SetupStep number={2} title={model.preferBundledInstall ? guide.loadTitle : guide.configureTitle}>
							{model.preferBundledInstall ? (
								<>
									<ol className="list-decimal space-y-1 pl-4">
										{guide.loadSteps.map((step) => (
											<li key={step}>{step}</li>
										))}
									</ol>
									<p className="text-[11px]">{guide.bundleHint}</p>
								</>
							) : (
								<p>{guide.configureBody}</p>
							)}
							{model.enabled && !model.targetDirty ? (
								<p className="font-medium text-foreground">{guide.configured}</p>
							) : (
								<Button
									variant="outline"
									size="sm"
									disabled={busy || model.conflict || !model.canSave}
									onClick={actions.save}
								>
									{model.enabled ? labels.saveTarget : labels.enable}
								</Button>
							)}
						</SetupStep>
						<SetupStep number={3} title={guide.authorizeTitle}>
							<p>{guide.authorizeBody}</p>
							<p className="rounded-lg border border-border px-3 py-2 text-foreground">{guide.tryPrompt}</p>
						</SetupStep>
					</ol>
					<details className="mt-5 border-t border-border pt-3">
						<summary className="cursor-pointer font-medium text-foreground">{guide.troubleshooting}</summary>
						<p className="mt-2">{guide.troubleshootingBody}</p>
						<p className="mt-2">{guide.advancedHint}</p>
						<Button variant="ghost" size="sm" className="mt-2" onClick={actions.openGuide}>
							{labels.guide}
						</Button>
					</details>
					{model.feedback && (
						<p role="status" className="mt-3">
							{model.feedback}
						</p>
					)}
					{model.error && (
						<p role="alert" className="mt-3 text-destructive">
							{model.error}
						</p>
					)}
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline" size="sm">
							{guide.close}
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
