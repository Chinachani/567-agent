import { useRef, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from "@vetta-org/ui";

export interface CustomImageProviderDraftView {
	name: string;
	baseUrl: string;
	model: string;
	apiKey: string;
	supportsTextToImage: boolean;
	supportsImageToImage: boolean;
}

export interface CustomImageProvidersViewModel {
	providers: readonly {
		id: string;
		name: string;
		baseUrl: string;
		model: string;
		supportsTextToImage: boolean;
		supportsImageToImage: boolean;
		hasApiKey: boolean;
	}[];
	limit: number;
	loading: boolean;
	busy: boolean;
	confirming: boolean;
	error?: string;
	formError?: string;
	draft: CustomImageProviderDraftView | null;
	editing: boolean;
	hasStoredKey: boolean;
	originChanged: boolean;
	labels: Record<
		| "title"
		| "description"
		| "add"
		| "edit"
		| "remove"
		| "empty"
		| "loading"
		| "retry"
		| "limit"
		| "addTitle"
		| "editTitle"
		| "name"
		| "baseUrl"
		| "model"
		| "apiKey"
		| "storedKey"
		| "textToImage"
		| "imageToImage"
		| "security"
		| "originChanged"
		| "cancel"
		| "save"
		| "saving"
		| "namePlaceholder"
		| "missingKey",
		string
	>;
	actions: {
		add(): void;
		edit(id: string): void;
		remove(id: string): void;
		reload(): void;
		change<K extends keyof CustomImageProviderDraftView>(key: K, value: CustomImageProviderDraftView[K]): void;
		close(): void;
		save(): void;
		restoreFocus(): void;
	};
}

/** Pure settings recipe; the host owns credentials, persistence and confirmation. */
export function CustomImageProvidersView({ model }: { model: CustomImageProvidersViewModel }): JSX.Element {
	const nameRef = useRef<HTMLInputElement>(null);
	const { labels: l, draft, actions } = model;
	return (
		<section className="mt-4 space-y-3" aria-label={l.title}>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-[13px] font-medium text-foreground">
						{l.title}{" "}
						<span className="ml-1 text-[11px] font-normal tabular-nums text-muted-foreground">
							{model.providers.length}/{model.limit}
						</span>
					</h3>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{l.description}</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					disabled={model.loading || model.busy || model.providers.length >= model.limit}
					title={model.providers.length >= model.limit ? l.limit : undefined}
					onClick={actions.add}
				>
					{l.add}
				</Button>
			</div>
			{model.loading ? (
				<p role="status" className="text-xs text-muted-foreground">
					{l.loading}
				</p>
			) : model.providers.length === 0 && !model.error ? (
				<p className="text-xs text-muted-foreground">{l.empty}</p>
			) : null}
			{model.error && (
				<div role="alert" className="flex items-center gap-2 text-xs text-destructive">
					{model.error}
					<Button variant="ghost" size="sm" disabled={model.busy} onClick={actions.reload}>
						{l.retry}
					</Button>
				</div>
			)}
			{model.providers.length > 0 && (
				<ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
					{model.providers.map((provider) => (
						<li key={provider.id} className="flex items-center gap-3 px-3 py-2.5">
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="truncate text-[13px] font-medium text-foreground">{provider.name}</span>
									{provider.supportsTextToImage && (
										<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
											{l.textToImage}
										</span>
									)}
									{provider.supportsImageToImage && (
										<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
											{l.imageToImage}
										</span>
									)}
								</div>
								<p className="mt-1 truncate text-[11px] text-muted-foreground" title={provider.baseUrl}>
									{provider.model} · {provider.baseUrl}
								</p>
								{!provider.hasApiKey && <p className="mt-1 text-[11px] text-amber-500">{l.missingKey}</p>}
							</div>
							<div className="flex shrink-0 gap-1">
								<Button
									variant="ghost"
									size="sm"
									disabled={model.busy}
									onClick={() => actions.edit(provider.id)}
									aria-label={`${l.edit} ${provider.name}`}
								>
									{l.edit}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="text-muted-foreground hover:text-destructive"
									disabled={model.busy}
									onClick={() => actions.remove(provider.id)}
									aria-label={`${l.remove} ${provider.name}`}
								>
									{l.remove}
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
			<Dialog
				open={draft !== null}
				modal={!model.confirming}
				onOpenChange={(open) => {
					if (!open) actions.close();
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="flex max-h-[85vh] max-w-[min(480px,calc(100%-2rem))] flex-col"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						nameRef.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						actions.restoreFocus();
					}}
					onInteractOutside={(event) => {
						event.preventDefault();
						actions.close();
					}}
				>
					<DialogHeader>
						<DialogTitle>{model.editing ? l.editTitle : l.addTitle}</DialogTitle>
						<DialogDescription>{l.description}</DialogDescription>
					</DialogHeader>
					{draft && (
						<form
							className="flex min-h-0 flex-col gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								actions.save();
							}}
						>
							<fieldset disabled={model.busy} className="min-h-0 space-y-3 overflow-y-auto px-0.5">
								<label className="block space-y-1.5 text-xs">
									{l.name}
									<Input
										ref={nameRef}
										value={draft.name}
										maxLength={64}
										placeholder={l.namePlaceholder}
										onChange={(e) => actions.change("name", e.target.value)}
										required
									/>
								</label>
								<label className="block space-y-1.5 text-xs">
									{l.baseUrl}
									<Input
										value={draft.baseUrl}
										maxLength={2048}
										placeholder="https://api.example.com/v1"
										onChange={(e) => actions.change("baseUrl", e.target.value)}
										required
										type="url"
										autoCapitalize="none"
										spellCheck={false}
									/>
								</label>
								<label className="block space-y-1.5 text-xs">
									{l.model}
									<Input
										value={draft.model}
										maxLength={128}
										placeholder="gpt-image-1"
										onChange={(e) => actions.change("model", e.target.value)}
										required
										spellCheck={false}
									/>
								</label>
								<label className="block space-y-1.5 text-xs">
									{l.apiKey}
									<Input
										value={draft.apiKey}
										maxLength={8192}
										type="password"
										autoComplete="new-password"
										placeholder={model.hasStoredKey && !model.originChanged ? l.storedKey : "sk-…"}
										onChange={(e) => actions.change("apiKey", e.target.value)}
										required={!model.hasStoredKey || model.originChanged}
									/>
								</label>
								{model.originChanged && <p className="text-[11px] text-amber-500">{l.originChanged}</p>}
								<div className="flex flex-wrap gap-4 text-xs">
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={draft.supportsTextToImage}
											onChange={(e) => actions.change("supportsTextToImage", e.target.checked)}
										/>
										{l.textToImage}
									</label>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={draft.supportsImageToImage}
											onChange={(e) => actions.change("supportsImageToImage", e.target.checked)}
										/>
										{l.imageToImage}
									</label>
								</div>
								<p className="text-[11px] leading-relaxed text-muted-foreground">{l.security}</p>
							</fieldset>
							{model.formError && (
								<p role="alert" className="text-xs text-destructive">
									{model.formError}
								</p>
							)}
							<DialogFooter>
								<Button type="button" variant="outline" disabled={model.busy} onClick={actions.close}>
									{l.cancel}
								</Button>
								<Button type="submit" disabled={model.busy}>
									{model.busy ? l.saving : l.save}
								</Button>
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
