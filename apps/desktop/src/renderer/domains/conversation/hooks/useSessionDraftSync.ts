import { parseInputSegments } from "@shared/lib/input-tokens";
import {
	activeInputDraftKeyAtom,
	appendLiteralSessionInputDraft,
	applySessionInputDraft,
	captureSessionInputDraft,
	computeDraftAppendSuffix,
	inputValueAtom,
	loadSessionInputDraft,
	onSessionInputDraftRekey,
	persistSessionInputDraft,
	type SessionInputDraft,
	sessionInputDraftMapAtom,
} from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { useEffect } from "react";
import type { SessionDraftAppendedEvent } from "../../../../shared/session-drafts-ipc";

const FOREGROUND_SYNC_DEBOUNCE_MS = 250;

const handoffDraftRevisions = new Map<string, number>();
const rekeyingKeys = new Set<string>();

/**
 * Synchronizes phone-to-desktop handoff drafts with the main process store and
 * active foreground input editor, leaving non-handoff local drafts strictly in RAM.
 */
export function useSessionDraftSync(): void {
	useEffect(() => {
		const draftsApi = window.agent567?.sessionDrafts;
		if (!draftsApi) return;

		const store = getDefaultStore();
		const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
		let activeKeySnapshot = store.get(activeInputDraftKeyAtom);
		let cancelled = false;

		const cancelPendingSync = (key: string): void => {
			const timer = pendingTimers.get(key);
			if (!timer) return;
			clearTimeout(timer);
			pendingTimers.delete(key);
		};

		const readLiveText = (key: string): string => {
			if (store.get(activeInputDraftKeyAtom) === key) {
				return store.get(inputValueAtom);
			}
			return loadSessionInputDraft(key).text;
		};

		const removePersistedKey = (key: string, revision: number): void => {
			void draftsApi
				.remove(key, revision)
				.then(() => {
					if (handoffDraftRevisions.get(key) === revision) {
						handoffDraftRevisions.delete(key);
					}
				})
				.catch(() => undefined);
		};

		const syncKeyNow = (key: string): void => {
			cancelPendingSync(key);
			const revision = handoffDraftRevisions.get(key);
			if (revision === undefined) return;
			const text = readLiveText(key);
			if (text.length === 0) {
				removePersistedKey(key, revision);
				return;
			}
			void draftsApi.save(key, text, revision).catch(() => undefined);
		};

		const scheduleForegroundSync = (key: string): void => {
			if (!handoffDraftRevisions.has(key)) return;
			cancelPendingSync(key);
			const timer = setTimeout(() => {
				pendingTimers.delete(key);
				syncKeyNow(key);
			}, FOREGROUND_SYNC_DEBOUNCE_MS);
			pendingTimers.set(key, timer);
		};

		const flushAllPending = (): void => {
			for (const key of [...pendingTimers.keys()]) {
				syncKeyNow(key);
			}
		};

		const handleAppended = (event: SessionDraftAppendedEvent): void => {
			if (cancelled) return;
			const knownRevision = handoffDraftRevisions.get(event.key);
			if (knownRevision !== undefined && event.revision <= knownRevision) return;
			cancelPendingSync(event.key);
			handoffDraftRevisions.set(event.key, event.revision);

			// If list() has not hydrated this key yet, preserve event.baseText so a boot-time
			// append does not overwrite earlier persisted draft text when syncing back.
			if (knownRevision === undefined) {
				const isForeground = store.get(activeInputDraftKeyAtom) === event.key;
				const current = isForeground ? captureSessionInputDraft() : loadSessionInputDraft(event.key);
				if (current.text.length === 0) {
					const hydrated: SessionInputDraft = {
						...current,
						text: event.nextText,
						segments: [{ kind: "text", text: event.nextText }],
					};
					persistSessionInputDraft(event.key, hydrated);
					if (isForeground) applySessionInputDraft(hydrated);
					return;
				}
				if (event.baseText && !current.text.includes(event.baseText)) {
					const separator =
						current.text.trim().length === 0
							? ""
							: event.baseText.endsWith("\n\n")
								? ""
								: event.baseText.endsWith("\n")
									? "\n"
									: "\n\n";
					const prefix = `${event.baseText}${separator}`;
					const mergedBaseText = `${prefix}${current.text}`;
					const appendSuffix = computeDraftAppendSuffix(mergedBaseText, event.appendText);
					const currentSegments = current.segments ?? parseInputSegments(current.text).segments;
					const merged: SessionInputDraft = {
						...current,
						text: `${mergedBaseText}${appendSuffix}`,
						segments: [
							...(prefix ? [{ kind: "text" as const, text: prefix }] : []),
							...currentSegments,
							...(appendSuffix ? [{ kind: "text" as const, text: appendSuffix }] : []),
						],
					};
					persistSessionInputDraft(event.key, merged);
					if (isForeground) applySessionInputDraft(merged);
					void draftsApi.save(event.key, merged.text, event.revision).catch(() => undefined);
					return;
				}
			}

			const nextDraft = appendLiteralSessionInputDraft(event.key, event.appendText);
			if (nextDraft.text !== event.nextText) {
				void draftsApi.save(event.key, nextDraft.text, event.revision).catch(() => undefined);
			}
		};

		const unsubscribeAppended = draftsApi.onAppended(handleAppended);

		void draftsApi
			.list()
			.then((persisted) => {
				if (cancelled) return;
				for (const [key, record] of Object.entries(persisted)) {
					const knownRevision = handoffDraftRevisions.get(key) ?? 0;
					if (knownRevision >= record.revision) continue;
					handoffDraftRevisions.set(key, record.revision);
					const isForeground = store.get(activeInputDraftKeyAtom) === key;
					const current = isForeground ? captureSessionInputDraft() : loadSessionInputDraft(key);
					if (current.text.length === 0) {
						const hydrated: SessionInputDraft = {
							...current,
							text: record.text,
							segments: [{ kind: "text", text: record.text }],
						};
						persistSessionInputDraft(key, hydrated);
						if (isForeground) applySessionInputDraft(hydrated);
						continue;
					}
					if (current.text === record.text || current.text.endsWith(record.text)) continue;
					const merged = appendLiteralSessionInputDraft(key, record.text);
					void draftsApi.save(key, merged.text, record.revision).catch(() => undefined);
				}
			})
			.catch(() => undefined);

		const unsubscribeInput = store.sub(inputValueAtom, () => {
			const key = store.get(activeInputDraftKeyAtom);
			if (!key || !handoffDraftRevisions.has(key)) return;
			scheduleForegroundSync(key);
		});

		const unsubscribeActiveKey = store.sub(activeInputDraftKeyAtom, () => {
			const prevKey = activeKeySnapshot;
			const nextKey = store.get(activeInputDraftKeyAtom);
			activeKeySnapshot = nextKey;
			if (prevKey && prevKey !== nextKey && handoffDraftRevisions.has(prevKey)) {
				syncKeyNow(prevKey);
			}
		});

		const unsubscribeDraftMap = store.sub(sessionInputDraftMapAtom, () => {
			const map = store.get(sessionInputDraftMapAtom);
			const activeKey = store.get(activeInputDraftKeyAtom);
			for (const [key, revision] of [...handoffDraftRevisions.entries()]) {
				if (rekeyingKeys.has(key)) continue;
				if (key in map) continue;
				// Active key edits keep live text in inputValueAtom until blur/scope switch/send.
				if (key === activeKey && store.get(inputValueAtom).length > 0) continue;
				cancelPendingSync(key);
				removePersistedKey(key, revision);
			}
		});

		const unsubscribeRekey = onSessionInputDraftRekey((fromKey, toKey) => {
			const revision = handoffDraftRevisions.get(fromKey);
			if (revision === undefined || fromKey === toKey) return;
			cancelPendingSync(fromKey);
			rekeyingKeys.add(fromKey);
			const movedText = readLiveText(toKey);
			if (movedText.length === 0) {
				void draftsApi
					.remove(fromKey, revision)
					.then(() => {
						if (handoffDraftRevisions.get(fromKey) === revision) {
							handoffDraftRevisions.delete(fromKey);
						}
					})
					.catch(() => undefined)
					.finally(() => {
						rekeyingKeys.delete(fromKey);
					});
				return;
			}
			void draftsApi
				.rekey(fromKey, toKey, revision)
				.then((nextRevision) => {
					if (handoffDraftRevisions.get(fromKey) === revision) {
						handoffDraftRevisions.delete(fromKey);
					}
					if (!cancelled && nextRevision !== null) {
						handoffDraftRevisions.set(toKey, nextRevision);
					}
				})
				.catch(() => undefined)
				.finally(() => {
					rekeyingKeys.delete(fromKey);
				});
		});

		const handleVisibilityChange = (): void => {
			if (document.visibilityState === "hidden") flushAllPending();
		};

		window.addEventListener("beforeunload", flushAllPending);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			cancelled = true;
			flushAllPending();
			unsubscribeAppended();
			unsubscribeInput();
			unsubscribeActiveKey();
			unsubscribeDraftMap();
			unsubscribeRekey();
			window.removeEventListener("beforeunload", flushAllPending);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);
}
