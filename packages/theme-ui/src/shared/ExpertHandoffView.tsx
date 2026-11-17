import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@vetta-org/ui";
import type { JSX } from "react";

export interface ExpertHandoffViewProps {
	readonly title: string;
	readonly description: string;
	readonly expertLabel: string;
	readonly expertId: string;
	readonly experts: readonly { id: string; name: string; disabled: boolean }[];
	readonly onExpert: (id: string) => void;
	readonly fields: readonly { id: string; label: string; value: string }[];
	readonly onField: (id: string, value: string) => void;
	readonly preview: string;
	readonly labels: { choose: string; latest: string; preview: string; apply: string; cancel: string };
	readonly onLatest: () => void;
	readonly latestDisabled: boolean;
	readonly onApply: () => void;
	readonly onClose: () => void;
	readonly disabled: boolean;
	readonly editingDisabled: boolean;
	readonly status?: string;
}
export function ExpertHandoffView(props: ExpertHandoffViewProps): JSX.Element {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
				<DialogHeader>
					<DialogTitle>{props.title}</DialogTitle>
					<DialogDescription>{props.description}</DialogDescription>
				</DialogHeader>
				<label className="grid gap-1 text-sm">
					{props.expertLabel}
					<select
						value={props.expertId}
						disabled={props.editingDisabled}
						onChange={(event) => props.onExpert(event.target.value)}
						className="rounded-lg border border-border bg-background p-2"
					>
						<option value="">{props.labels.choose}</option>
						{props.experts.map((expert) => (
							<option key={expert.id} value={expert.id} disabled={expert.disabled}>
								{expert.name}
							</option>
						))}
					</select>
				</label>
				{props.fields.map((field) => (
					<label key={field.id} className="grid gap-1 text-sm">
						{field.label}
						<textarea
							rows={3}
							value={field.value}
							disabled={props.editingDisabled}
							maxLength={8000}
							onChange={(event) => props.onField(field.id, event.target.value)}
							className="rounded-lg border border-border bg-background p-2"
						/>
					</label>
				))}
				<Button variant="outline" size="sm" disabled={props.latestDisabled} onClick={props.onLatest}>
					{props.labels.latest}
				</Button>
				<details>
					<summary className="cursor-pointer text-sm">{props.labels.preview}</summary>
					<pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs font-sans">
						{props.preview}
					</pre>
				</details>
				{props.status && (
					<p role="status" className="text-sm text-muted-foreground">
						{props.status}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={props.onClose}>
						{props.labels.cancel}
					</Button>
					<Button disabled={props.disabled} onClick={props.onApply}>
						{props.labels.apply}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
