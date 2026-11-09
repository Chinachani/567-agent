import { i18n } from "@shared/i18n";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { showToast } from "@shared/store/toast-atoms";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeUiZoomFactor, UI_ZOOM_DEFAULT } from "@/shared/ui-zoom";

export function reportUiZoomFailure(): void {
	showToast({ variant: "error", message: i18n.t("settings:uiZoomFailed") });
}

/** Mirror the main-owned persisted factor. Drag previews remain local to the control. */
export function useUiZoom() {
	const [factor, setFactorState] = useState(UI_ZOOM_DEFAULT);
	const [saving, setSaving] = useState(false);
	const mounted = useRef(false);
	const pending = useRef(false);
	const revision = useRef(0);
	useEffect(() => {
		mounted.current = true;
		const initial = ++revision.current;
		const off = window.agent567.uiZoom.onChanged((value) => {
			++revision.current;
			setFactorState(normalizeUiZoomFactor(value));
		});
		void window.agent567.uiZoom.get().then(
			(value) => {
				if (mounted.current && revision.current === initial) setFactorState(normalizeUiZoomFactor(value));
			},
			() => {
				if (mounted.current && revision.current === initial) reportUiZoomFailure();
			},
		);
		return () => {
			mounted.current = false;
			++revision.current;
			off();
		};
	}, []);
	const setFactor = useCallback(async (value: number) => {
		if (pending.current) return;
		pending.current = true;
		setSaving(true);
		++revision.current;
		try {
			await waitForCommittedPaint();
			if (!mounted.current) return;
			const requestVersion = revision.current;
			const result = await window.agent567.uiZoom.set(normalizeUiZoomFactor(value));
			if (mounted.current && revision.current === requestVersion) setFactorState(result);
		} catch {
			if (mounted.current) reportUiZoomFailure();
		} finally {
			pending.current = false;
			if (mounted.current) setSaving(false);
		}
	}, []);
	const reset = useCallback(() => void setFactor(UI_ZOOM_DEFAULT), [setFactor]);
	return { factor, saving, setFactor, reset };
}
