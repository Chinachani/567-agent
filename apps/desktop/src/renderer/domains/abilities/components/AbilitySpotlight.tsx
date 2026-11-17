import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AbilityItem } from "../types";
import { AbilitySpotlightView } from "./AbilitySpotlightView";

export function AbilitySpotlight({ items }: { readonly items: readonly AbilityItem[] }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const candidates = useMemo(
		() =>
			items
				.filter((item) => item.fromMarket && !item.isCustom && item.reviewStatus !== "unreviewed")
				.sort((a, b) => a.id.localeCompare(b.id))
				.slice(0, 5),
		[items],
	);
	const index = Math.max(
		0,
		candidates.findIndex((item) => item.id === selectedId),
	);
	const item = candidates[index];
	if (!item) return null;
	const move = (direction: number): void => {
		const next = candidates[(index + direction + candidates.length) % candidates.length];
		if (next) setSelectedId(next.id);
	};
	return (
		<AbilitySpotlightView
			item={item}
			canSwitch={candidates.length > 1}
			labels={{
				title: t("spotlight.title"),
				detail: t("spotlight.detail"),
				previous: t("spotlight.previous"),
				next: t("spotlight.next"),
				position: t("spotlight.position", { current: index + 1, total: candidates.length }),
			}}
			onPrevious={() => move(-1)}
			onNext={() => move(1)}
			onDetail={() => {
				void navigate({ to: "/abilities", search: { detail: item.id } });
			}}
		/>
	);
}
