export interface DiscoveryFilterField {
	key: string;
	label: string;
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (value: string) => void;
}

export function DiscoveryFiltersView({
	fields,
	allLabel,
	title,
}: {
	fields: DiscoveryFilterField[];
	allLabel: string;
	title: string;
}) {
	return (
		<fieldset className="flex flex-col gap-2 border-t border-border/60 pt-3">
			<legend className="px-1 text-[11px] text-muted-foreground">{title}</legend>
			{fields.map((field) => (
				<label key={field.key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
					{field.label}
					<select
						aria-label={field.label}
						value={field.value}
						onChange={(event) => field.onChange(event.target.value)}
						className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
					>
						<option value="">{allLabel}</option>
						{field.options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
			))}
		</fieldset>
	);
}
