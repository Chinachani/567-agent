import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextWorkspaceSnapshot } from "../../../../shared/context-workspace";

export function useContextWorkspace(sessionId: string | null, open: boolean) {
	const [snapshot, setSnapshot] = useState<ContextWorkspaceSnapshot | null>(null);
	const [pinned, setPinned] = useState("");
	const [excluded, setExcluded] = useState<readonly string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [saved, setSaved] = useState(false);
	const generation = useRef(0);
	useEffect(() => {
		const version = ++generation.current;
		setSnapshot(null);
		setBusy(false);
		setError(false);
		setSaved(false);
		if (!open || !sessionId) return;
		void window.agent567.session
			.readContextWorkspace(sessionId)
			.then((value) => {
				if (generation.current !== version) return;
				setSnapshot(value);
				setPinned(value.pinnedText);
				setExcluded(value.excludedTurnIds);
			})
			.catch(() => {
				if (generation.current === version) setError(true);
			});
		return () => {
			generation.current++;
		};
	}, [sessionId, open]);
	const dirty =
		!!snapshot &&
		(pinned !== snapshot.pinnedText ||
			excluded.length !== snapshot.excludedTurnIds.length ||
			excluded.some((id) => !snapshot.excludedTurnIds.includes(id)));
	const save = useCallback(async () => {
		if (!sessionId || !snapshot || busy || !dirty) return;
		const version = generation.current;
		setBusy(true);
		setError(false);
		setSaved(false);
		try {
			const value = await window.agent567.session.updateContextSelection(sessionId, {
				sessionId: snapshot.sessionId,
				documentRevision: snapshot.documentRevision,
				revision: snapshot.revision,
				pinnedText: pinned,
				excludedTurnIds: excluded,
			});
			if (generation.current !== version) return;
			setSnapshot(value);
			setPinned(value.pinnedText);
			setExcluded(value.excludedTurnIds);
			setSaved(true);
		} catch {
			if (generation.current === version) setError(true);
		} finally {
			if (generation.current === version) setBusy(false);
		}
	}, [sessionId, snapshot, pinned, excluded, busy, dirty]);
	return {
		snapshot,
		pinned,
		setPinned,
		excluded,
		dirty,
		saved,
		busy,
		error,
		save,
		setIncluded: (ids: readonly string[], included: boolean) => {
			const target = new Set(ids);
			setExcluded((current) =>
				included ? current.filter((id) => !target.has(id)) : [...new Set([...current, ...ids])],
			);
		},
		reset: () => {
			if (!snapshot) return;
			setPinned(snapshot.pinnedText);
			setExcluded(snapshot.excludedTurnIds);
			setError(false);
			setSaved(false);
		},
	};
}
export type ContextWorkspaceModel = ReturnType<typeof useContextWorkspace>;
