import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";
import { useEffect, useId, useState } from "react";

export interface SearchableSelectProps {
	readonly value: string;
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly onValueChange: (value: string) => void;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly labels: {
		readonly trigger: string;
		readonly search: string;
		readonly placeholder: string;
		readonly empty: string;
	};
}

/** Local filtering never changes the selection until the user chooses an option. */
export function SearchableSelect({
	value,
	options,
	onValueChange,
	disabled,
	labels,
	className,
}: SearchableSelectProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const listId = useId();
	const matches = options.filter((option) =>
		`${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()),
	);
	useEffect(() => {
		if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
	}, [open, active, listId]);
	const selected = options.find((option) => option.value === value);
	const choose = (next: string) => {
		onValueChange(next);
		setOpen(false);
	};
	return (
		<Popover
			open={open && !disabled}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery("");
				setActive(
					Math.max(
						0,
						options.findIndex((option) => option.value === value),
					),
				);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className={`w-full min-w-0 justify-between${className ? ` ${className}` : ""}`}
					aria-label={labels.trigger}
					disabled={disabled}
				>
					<span className="truncate">{selected?.label ?? labels.placeholder}</span>
					<span aria-hidden className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 shrink-0" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[var(--radix-popover-trigger-width)] min-w-0 p-2"
				aria-label={labels.trigger}
			>
				<Input
					role="combobox"
					aria-label={labels.search}
					aria-autocomplete="list"
					aria-expanded={open}
					aria-controls={listId}
					aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
					placeholder={labels.placeholder}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							const next = matches.length
								? (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length
								: 0;
							setActive(next);
						} else if (event.key === "Enter") {
							event.preventDefault();
							if (matches[active]) choose(matches[active].value);
						}
					}}
				/>
				<div id={listId} role="listbox" aria-label={labels.trigger} className="mt-2 max-h-64 overflow-y-auto">
					{matches.map((option, index) => (
						<Button
							key={option.value}
							id={`${listId}-${index}`}
							role="option"
							aria-selected={option.value === value}
							variant={index === active ? "secondary" : "ghost"}
							className="h-auto min-h-8 w-full justify-start whitespace-normal break-all text-left text-[12px]"
							onClick={() => choose(option.value)}
							onMouseEnter={() => setActive(index)}
						>
							{option.label}
						</Button>
					))}
				</div>
				{matches.length === 0 ? (
					<p role="status" className="px-2 py-3 text-[12px] text-muted-foreground">
						{labels.empty}
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
