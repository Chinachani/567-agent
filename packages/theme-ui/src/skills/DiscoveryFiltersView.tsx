import { FilterSelectField } from "./FilterSelectField";

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
				<FilterSelectField
					key={field.key}
					label={field.label}
					value={field.value}
					options={field.options}
					allLabel={allLabel}
					onValueChange={field.onChange}
				/>
			))}
		</fieldset>
	);
}
