import { Button } from "@vetta-org/ui";

export function NewSessionQuickStartView({
	items,
}: {
	readonly items: readonly { readonly label: string; readonly onSelect: () => void; readonly disabled?: boolean }[];
}) {
	return (
		<div className="flex flex-wrap justify-center gap-x-1 gap-y-1 py-2">
			{items.map((item) => (
				<Button
					key={item.label}
					variant="ghost"
					size="xs"
					className="rounded-full px-2.5 text-muted-foreground hover:text-foreground"
					disabled={item.disabled}
					onClick={item.onSelect}
				>
					{item.label}
				</Button>
			))}
		</div>
	);
}
