import type { SessionWorkbenchDetail, SessionWorkbenchSnapshot } from "@567agent/remote-control";
import { useCallback, useEffect, useRef, useState } from "react";

export function useSessionWorkbench(sessionId: string | null, open: boolean) {
	const [snapshot, setSnapshot] = useState<SessionWorkbenchSnapshot | null>(null);
	const [detail, setDetail] = useState<SessionWorkbenchDetail | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const request = useRef(0);
	const refresh = useCallback(async () => {
		if (!sessionId) {
			setSnapshot({ attachments: [], tasks: [], changes: [] });
			return;
		}
		const version = ++request.current;
		setBusy(true);
		setError(false);
		try {
			const value = await window.agent567.session.readWorkbench(sessionId);
			if (version === request.current) setSnapshot(value);
		} catch {
			if (version === request.current) setError(true);
		} finally {
			if (version === request.current) setBusy(false);
		}
	}, [sessionId]);
	useEffect(() => {
		if (!open) return;
		void refresh();
		return () => {
			request.current++;
		};
	}, [refresh, open]);
	const select = async (kind: "attachment" | "task" | "change", id: string) => {
		if (!sessionId || reviewing) return;
		const version = ++request.current;
		setBusy(true);
		setDetail(null);
		setError(false);
		try {
			const value = await window.agent567.session.readWorkbenchDetail(sessionId, kind, id);
			if (version === request.current) setDetail(value);
		} catch {
			if (version === request.current) setError(true);
		} finally {
			if (version === request.current) setBusy(false);
		}
	};
	const review = async (action: "keep" | "revert") => {
		if (!sessionId || busy || detail?.kind !== "change") return;
		setReviewing(true);
		const version = ++request.current;
		setBusy(true);
		setError(false);
		try {
			const value = await window.agent567.session.reviewChange(
				sessionId,
				detail.id,
				action,
				detail.afterRevision ?? "",
			);
			if (version === request.current) {
				setSnapshot(value);
				setDetail(null);
			}
		} catch {
			if (version === request.current) setError(true);
		} finally {
			if (version === request.current) {
				setBusy(false);
				setReviewing(false);
			}
		}
	};
	const clearDetail = () => {
		if (reviewing) return;
		request.current++;
		setDetail(null);
		setBusy(false);
	};
	return { snapshot, detail, clearDetail, busy, reviewing, error, refresh, select, review };
}

export type SessionWorkbenchModel = ReturnType<typeof useSessionWorkbench>;
