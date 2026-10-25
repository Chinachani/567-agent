import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

export function matchesSettingsSearch(query: string, values: readonly string[]): boolean {
	const text = values.join(" ").toLocaleLowerCase();
	return query
		.trim()
		.toLocaleLowerCase()
		.split(/\s+/)
		.every((term) => text.includes(term));
}

export function SettingsListSearch({
	value,
	onChange,
	label,
	count,
	total,
}: {
	value: string;
	onChange(value: string): void;
	label: string;
	count: number;
	total: number;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const input = useRef<HTMLInputElement>(null);
	return (
		<div className="space-y-1.5 px-4 py-3">
			<div className="relative">
				<span
					aria-hidden="true"
					className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					ref={input}
					type="search"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					aria-label={label}
					placeholder={label}
					className="h-8 pl-8 pr-9 text-[12px]"
				/>
				{value && (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("listSearch.clear")}
						className="absolute right-1 top-1/2 -translate-y-1/2"
						onClick={() => {
							onChange("");
							input.current?.focus();
						}}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			{value.trim() && (
				<p aria-live="polite" className="text-[11px] text-muted-foreground">
					{t("listSearch.results", { count, total })}
				</p>
			)}
		</div>
	);
}
