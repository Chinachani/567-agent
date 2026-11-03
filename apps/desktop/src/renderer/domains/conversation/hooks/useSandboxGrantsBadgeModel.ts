import type { RuntimeSandboxGrantInfo } from "@567agent/runtime-core";
import { activeSessionAtom } from "@shared/store/atoms";
import type { SandboxGrantsBadgeViewLabels, SandboxGrantViewItem } from "@vetta-org/theme-ui/chat";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const REFRESH_INTERVAL_MS = 4000;

function formatRelative(timestamp: number, now: number, t: TFunction<"chat">): string {
	const deltaSec = Math.max(0, Math.round((now - timestamp) / 1000));
	if (deltaSec < 60) return t("sandboxGrantsBadge.secondsAgo", { count: deltaSec });
	const min = Math.floor(deltaSec / 60);
	if (min < 60) return t("sandboxGrantsBadge.minutesAgo", { count: min });
	const hr = Math.floor(min / 60);
	if (hr < 24) return t("sandboxGrantsBadge.hoursAgo", { count: hr });
	const day = Math.floor(hr / 24);
	return t("sandboxGrantsBadge.daysAgo", { count: day });
}

function formatAbsolute(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

function capabilityLabel(cap: RuntimeSandboxGrantInfo["capability"], t: TFunction<"chat">): string {
	switch (cap) {
		case "file.read":
			return t("capability.read");
		case "file.write":
			return t("capability.write");
		case "network":
			return t("capability.network");
		default:
			return cap;
	}
}

export interface SandboxGrantsBadgeModel {
	count: number;
	open: boolean;
	grants: SandboxGrantViewItem[];
	labels: SandboxGrantsBadgeViewLabels;
	pending: boolean;
	error?: string;
	onOpenChange: (open: boolean) => void;
	onRevokeAll: () => void;
	onRevoke: (grantId: string) => void;
}

export function useSandboxGrantsBadgeModel(): SandboxGrantsBadgeModel | null {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const sessionId = activeSession?.runtimeId;
	const scope = useMemo(() => ({ sessionId }), [sessionId]);
	const [snapshot, setSnapshot] = useState<{ scope: typeof scope; grants: RuntimeSandboxGrantInfo[] } | null>(null);
	const [openedFor, setOpenedFor] = useState<typeof scope | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<"revokeFailed" | "refreshFailed" | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const currentScope = useRef(scope);
	currentScope.current = scope;
	const mounted = useRef(false);
	const requestVersion = useRef(0);
	const mutation = useRef<{ sessionId: string } | null>(null);
	const grants = snapshot?.scope === scope ? snapshot.grants : [];

	const refresh = useCallback(async () => {
		if (!sessionId || currentScope.current !== scope) return false;
		const version = ++requestVersion.current;
		try {
			const result = await window.agent567.session.listSandboxGrants(sessionId);
			if (!mounted.current || currentScope.current !== scope || version !== requestVersion.current) return false;
			setSnapshot({ scope, grants: result });
			setError((previous) => (previous === "refreshFailed" ? null : previous));
			setNow(Date.now());
			return true;
		} catch {
			// Ignore — IPC may be torn down during navigation.
			return false;
		}
	}, [sessionId, scope]);

	useEffect(() => {
		mounted.current = true;
		setOpenedFor(null);
		setError(null);
		setPending(false);
		mutation.current = null;
		void refresh();
		const id = window.setInterval(() => {
			if (!mutation.current) void refresh();
		}, REFRESH_INTERVAL_MS);
		return () => {
			mounted.current = false;
			requestVersion.current += 1;
			window.clearInterval(id);
		};
	}, [refresh]);

	const changeOpen = useCallback(
		(open: boolean) => {
			setOpenedFor(open ? scope : null);
			if (open && !mutation.current) void refresh();
		},
		[scope, refresh],
	);

	const revoke = useCallback(
		async (grantId?: string) => {
			if (!sessionId || currentScope.current !== scope || mutation.current) return;
			const operation = { sessionId };
			mutation.current = operation;
			// A list started before revocation must not restore the old grant afterwards.
			requestVersion.current += 1;
			setPending(true);
			setError(null);
			const isCurrent = () => mounted.current && currentScope.current === scope && mutation.current === operation;
			try {
				if (grantId) await window.agent567.session.revokeSandboxGrant(sessionId, grantId);
				else await window.agent567.session.revokeAllSandboxGrants(sessionId);
				if (!isCurrent()) return;
				const refreshed = await refresh();
				if (isCurrent() && !refreshed) setError("refreshFailed");
			} catch {
				if (isCurrent()) setError("revokeFailed");
			} finally {
				if (isCurrent()) setPending(false);
				if (mutation.current === operation) mutation.current = null;
			}
		},
		[sessionId, scope, refresh],
	);

	const sortedGrants = useMemo(
		(): SandboxGrantViewItem[] =>
			grants
				.slice()
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((grant) => ({
					id: grant.id,
					capabilityLabel: capabilityLabel(grant.capability, t),
					toolName: grant.toolName,
					grantRoot: grant.grantRoot,
					relativeTime: formatRelative(grant.createdAt, now, t),
					absoluteTime: formatAbsolute(grant.createdAt),
				})),
		[grants, now, t],
	);

	const labels = useMemo(
		(): SandboxGrantsBadgeViewLabels => ({
			tooltip: t("sandboxGrantsBadge.tooltip"),
			title: t("sandboxGrantsBadge.title"),
			revokeAll: t("sandboxGrantsBadge.revokeAll"),
			revoke: t("sandboxGrantsBadge.revoke"),
		}),
		[t],
	);

	if (!sessionId || grants.length === 0) return null;

	return {
		count: grants.length,
		open: openedFor === scope,
		grants: sortedGrants,
		labels,
		pending,
		error: error ? t(`sandboxGrantsBadge.${error}`) : undefined,
		onOpenChange: changeOpen,
		onRevokeAll: () => void revoke(),
		onRevoke: (grantId) => void revoke(grantId),
	};
}
