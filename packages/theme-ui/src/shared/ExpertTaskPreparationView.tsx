import { Button } from "@vetta-org/ui";
import type { JSX } from "react";

export interface ExpertTaskPreparationViewProps {
	readonly title: string;
	readonly description: string;
	readonly hints: readonly string[];
	readonly fields: readonly { id: string; label: string; value: string; placeholder: string; required?: boolean }[];
	readonly preview: string;
	readonly previewLabel: string;
	readonly applyLabel: string;
	readonly status: string;
	readonly disabled: boolean;
	readonly onChange: (id: string, value: string) => void;
	readonly onApply: () => void;
}

/** A local task brief, not an executable workflow or a provider-owned form. */
export function ExpertTaskPreparationView(props: ExpertTaskPreparationViewProps): JSX.Element {
	return (
		<details className="my-3 max-h-[45vh] overflow-y-auto rounded-lg border border-border p-3">
			<summary className="cursor-pointer text-sm font-medium text-foreground">{props.title}</summary>
			<p className="mt-2 text-xs text-muted-foreground">{props.description}</p>
			{props.hints.length > 0 && (
				<ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
					{props.hints.map((hint, index) => (
						<li key={`${index}:${hint}`}>{hint}</li>
					))}
				</ul>
			)}
			<div className="mt-3 grid gap-3">
				{props.fields.map((field) => (
					<label key={field.id} className="flex flex-col gap-1 text-xs text-muted-foreground">
						<span>{field.label}</span>
						<textarea
							value={field.value}
							required={field.required}
							rows={2}
							maxLength={4000}
							onChange={(event) => props.onChange(field.id, event.target.value)}
							placeholder={field.placeholder}
							className="min-w-0 resize-y rounded-lg border border-border bg-background p-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</label>
				))}
			</div>
			{props.preview && (
				<details className="mt-3 text-xs">
					<summary className="cursor-pointer text-muted-foreground">{props.previewLabel}</summary>
					<pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-foreground">
						{props.preview}
					</pre>
				</details>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" disabled={props.disabled} onClick={props.onApply}>
					{props.applyLabel}
				</Button>
				<span role="status" className="text-xs text-muted-foreground">
					{props.status}
				</span>
			</div>
		</details>
	);
}
