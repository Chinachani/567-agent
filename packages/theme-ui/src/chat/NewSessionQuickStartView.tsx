import { Button } from "@vetta-org/ui";

export function NewSessionQuickStartView({
	items,
}: {
	readonly items: readonly { readonly label: string; readonly onSelect: () => void; readonly disabled?: boolean }[];
}) {
	return (
		<div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 py-2">
			{items.map((item) => (
				<Button
					key={item.label}
					variant="ghost"
					size="xs"
					className="min-h-8 rounded-lg bg-muted/60 px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
					disabled={item.disabled}
					onClick={item.onSelect}
				>
					{item.label}
				</Button>
			))}
		</div>
	);
}
