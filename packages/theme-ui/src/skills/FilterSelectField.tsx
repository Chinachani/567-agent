import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@vetta-org/ui";
import type { JSX } from "react";

/** Radix Select forbids empty string item values; map empty filter values to an internal sentinel. */
const EMPTY_SELECT_VALUE = "__filter_all__";

export interface FilterSelectOption {
	readonly value: string;
	readonly label: string;
}

export interface FilterSelectFieldProps {
	readonly label: string;
	readonly value: string;
	readonly options: readonly FilterSelectOption[];
	readonly allLabel?: string;
	readonly onValueChange: (value: string) => void;
	readonly className?: string;
}

function encodeSelectValue(value: string): string {
	return value === "" ? EMPTY_SELECT_VALUE : value;
}

function decodeSelectValue(value: string): string {
	return value === EMPTY_SELECT_VALUE ? "" : value;
}

/** Shared Radix Select field for abilities and discovery filter popovers. */
export function FilterSelectField({
	label,
	value,
	options,
	allLabel,
	onValueChange,
	className,
}: FilterSelectFieldProps): JSX.Element {
	const normalizedOptions = allLabel === undefined ? options : [{ value: "", label: allLabel }, ...options];

	return (
		<div className={cn("flex flex-col gap-1 text-[11px] text-muted-foreground", className)}>
			<span>{label}</span>
			<Select value={encodeSelectValue(value)} onValueChange={(next) => onValueChange(decodeSelectValue(next))}>
				<SelectTrigger aria-label={label} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{normalizedOptions.map((option) => {
						const itemValue = encodeSelectValue(option.value);
						return (
							<SelectItem key={itemValue} value={itemValue}>
								{option.label}
							</SelectItem>
						);
					})}
				</SelectContent>
			</Select>
		</div>
	);
}
