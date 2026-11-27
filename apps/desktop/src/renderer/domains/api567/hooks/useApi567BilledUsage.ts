import { useEffect, useState } from "react";
import type { Api567BilledSnapshot } from "@/shared/local-usage-log";

/** The caller scopes this mounted card to the open menu and the current account. */
export function useApi567BilledUsage(signedIn: boolean) {
	const [snapshot, setSnapshot] = useState<Api567BilledSnapshot>();
	const [attempt, setAttempt] = useState(0);
	const [loading, setLoading] = useState(signedIn);
	const [locked, setLocked] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a manual refresh starts a new request.
	useEffect(() => {
		if (!signedIn) return;
		let current = true;
		setLoading(true);
		void (async () => {
			try {
				const result = await window.agent567.api567.getBilledUsage();
				if (current) setSnapshot(result);
			} catch {
				if (current) {
					setSnapshot((previous) => ({
						...previous,
						status: previous?.quota != null ? "stale" : "unavailable",
						retryAt: Date.now() + 30_000,
					}));
				}
			} finally {
				if (current) setLoading(false);
			}
		})();
		return () => {
			current = false;
		};
	}, [attempt, signedIn]);

	useEffect(() => {
		if (snapshot?.checkedAt == null) return;
		const midnight = new Date(snapshot.checkedAt).setHours(24, 0, 0, 0);
		const expire = () => {
			if (Date.now() >= midnight) {
				setSnapshot((current) =>
					current === snapshot ? { status: "unavailable", retryAt: snapshot.retryAt } : current,
				);
			}
		};
		const timer = setTimeout(expire, Math.max(0, midnight - Date.now()));
		window.addEventListener("focus", expire);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("focus", expire);
		};
	}, [snapshot]);

	useEffect(() => {
		const remaining = (snapshot?.retryAt ?? 0) - Date.now();
		setLocked(remaining > 0);
		if (remaining <= 0) return;
		const timer = setTimeout(() => setLocked(false), Math.min(remaining, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [snapshot?.retryAt]);

	return {
		snapshot,
		loading,
		locked,
		refresh: () => {
			if (!signedIn || loading || locked) return;
			setAttempt((value) => value + 1);
		},
	};
}
