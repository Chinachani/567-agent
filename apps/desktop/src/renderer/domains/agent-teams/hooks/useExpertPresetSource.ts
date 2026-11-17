import type { ExpertPresetSourceStatus } from "@preload/api-types/agent-teams";
import { useCallback, useEffect, useRef, useState } from "react";

/** Source status is independent from profile loading: slow networks never hide local experts. */
export function useExpertPresetSource(onUpdated: () => Promise<void>) {
	const [status, setStatus] = useState<ExpertPresetSourceStatus>({
		phase: "idle",
		syncedAt: null,
		count: 0,
		hasCache: false,
	});
	const [refreshing, setRefreshing] = useState(false);
	const mounted = useRef(false);
	const sequence = useRef(0);
	const pending = useRef(false);
	const read = useCallback(async () => {
		const request = ++sequence.current;
		try {
			const next = await window.agent567.agentTeams.getPresetSourceStatus();
			if (mounted.current && request === sequence.current) {
				setStatus(next);
				return next;
			}
		} catch {
			if (mounted.current && request === sequence.current)
				setStatus((previous) => ({ ...previous, phase: "error", error: "sync-failed" }));
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		const unsubscribe = window.agent567.agentTeams.onPresetSourceStatusChanged(() => {
			void read()
				.then((next) => {
					if (next && next.phase !== "syncing") return onUpdated();
				})
				.catch(() => undefined);
		});
		void read();
		return () => {
			mounted.current = false;
			++sequence.current;
			unsubscribe();
		};
	}, [read, onUpdated]);
	const refresh = useCallback(async () => {
		if (pending.current) return;
		pending.current = true;
		setRefreshing(true);
		try {
			await window.agent567.agentTeams.refreshPresetSource();
			await read();
			await onUpdated();
		} catch {
			if (mounted.current) setStatus((previous) => ({ ...previous, phase: "error", error: "sync-failed" }));
		} finally {
			pending.current = false;
			if (mounted.current) setRefreshing(false);
		}
	}, [onUpdated, read]);
	return { status, refreshing: refreshing || status.phase === "syncing", refresh };
}
