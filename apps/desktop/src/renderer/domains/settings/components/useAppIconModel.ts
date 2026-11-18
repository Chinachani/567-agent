import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_ICON_DEFAULT, APP_ICON_IDS, APP_ICON_PREVIEWS, type AppIconId } from "@/shared/app-icon";

const previews = import.meta.glob<string>("../assets/app-icons/*.png", {
	eager: true,
	import: "default",
	query: "?url",
});

export function useAppIconModel() {
	const { t } = useTranslation("settings");
	const [selected, setSelected] = useState<AppIconId>(APP_ICON_DEFAULT);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		let active = true;
		let changed = false;
		const unsubscribe = window.agent567.appIcon.onChanged((value) => {
			changed = true;
			if (active) setSelected(value);
		});
		void window.agent567.appIcon
			.get()
			.then((value) => {
				if (active && !changed) setSelected(value);
			})
			.catch(() => {
				if (active) setError(t("appIcon.loadFailed"));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
			mounted.current = false;
			unsubscribe();
		};
	}, [t]);
	const select = useCallback(
		(value: AppIconId) => {
			if (busy.current) return;
			busy.current = true;
			setSaving(true);
			setError(null);
			void window.agent567.appIcon
				.set(value)
				.catch(() => {
					if (mounted.current) setError(t("appIcon.saveFailed"));
				})
				.finally(() => {
					busy.current = false;
					if (mounted.current) setSaving(false);
				});
		},
		[t],
	);
	return {
		title: t("appIcon.title"),
		hint: t("appIcon.hint"),
		loading,
		saving,
		error,
		select,
		options: APP_ICON_IDS.map((id) => ({
			id,
			label: t(`appIcon.names.${id}`),
			active: selected === id,
			preview: previews[`../assets/app-icons/${APP_ICON_PREVIEWS[id]}`],
		})),
	};
}
export type AppIconModel = ReturnType<typeof useAppIconModel>;
