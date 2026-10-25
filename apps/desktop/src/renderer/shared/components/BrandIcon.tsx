import { cn } from "@shared/lib/utils";

/** Decorative brand asset; the adjacent heading supplies its accessible name. */
export function BrandIcon({ className }: { className?: string }): JSX.Element {
	return (
		<span className={cn("inline-flex shrink-0", className)} aria-hidden="true">
			<img src={`${import.meta.env.BASE_URL}brand/icon-light.svg`} alt="" className="block size-full dark:hidden" draggable={false} />
			<img src={`${import.meta.env.BASE_URL}brand/icon-dark.svg`} alt="" className="hidden size-full dark:block" draggable={false} />
		</span>
	);
}
