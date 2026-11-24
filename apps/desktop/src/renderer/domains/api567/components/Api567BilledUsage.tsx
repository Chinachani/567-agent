import type { Api567BilledSnapshot } from "@/shared/local-usage-log";
import { Button } from "@shared/components/ui/button";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api567StatusAtom } from "../store/api567-atoms";

export function Api567BilledUsage(): JSX.Element {
	const account = useAtomValue(api567StatusAtom);
	const identity = JSON.stringify([account.isLoggedIn, account.loginUsername ?? account.username, account.authType, account.serviceRoute]);
	return <BilledPanel key={identity} signedIn={account.isLoggedIn} />;
}

function BilledPanel({ signedIn }: { signedIn: boolean }): JSX.Element {
	const { t, i18n } = useTranslation("settings");
	const [snapshot, setSnapshot] = useState<Api567BilledSnapshot>();
	const [attempt, setAttempt] = useState(0);
	const [loading, setLoading] = useState(signedIn);
	const [locked, setLocked] = useState(false);
	useEffect(() => {
		if (!signedIn) return;
		let active = true;
		setLoading(true);
		void window.agent567.api567.getBilledUsage().then(result => { if (active) setSnapshot(result); }, () => {
			if (active) setSnapshot(previous => ({ ...previous, status: previous?.quota != null ? "stale" : "unavailable", retryAt: Date.now() + 30_000 }));
		}).finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [attempt, signedIn]);
	useEffect(() => {
		if (snapshot?.checkedAt == null) return;
		const end = new Date(snapshot.checkedAt).setHours(24, 0, 0, 0);
		const expire = () => {
			if (Date.now() >= end) setSnapshot(previous => previous === snapshot ? { status: "unavailable", retryAt: previous.retryAt } : previous);
		};
		const timer = setTimeout(expire, Math.max(0, end - Date.now()));
		window.addEventListener("focus", expire);
		return () => { clearTimeout(timer); window.removeEventListener("focus", expire); };
	}, [snapshot]);
	useEffect(() => {
		const remaining = (snapshot?.retryAt ?? 0) - Date.now();
		setLocked(remaining > 0);
		if (remaining <= 0) return;
		const timer = setTimeout(() => setLocked(false), Math.min(remaining, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [snapshot]);
	const locale = i18n.resolvedLanguage || undefined;
	const state = !signedIn ? "signed-out" : loading ? "loading" : snapshot?.status ?? "unavailable";
	return <section className="space-y-2 rounded-lg border border-border p-4" aria-busy={loading}>
		<div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("usageBill.title")}</h2>
			{signedIn && <Button variant="ghost" size="sm" disabled={loading || locked} onClick={() => setAttempt(value => value + 1)}>{t("usageBill.refresh")}</Button>}</div>
		{snapshot?.quota != null && <p className="text-lg font-semibold tabular-nums">{snapshot.usd != null && `${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(snapshot.usd)} · `}{t("usageBill.units", { amount: snapshot.quota.toLocaleString(locale) })}</p>}
		<p className="text-xs text-muted-foreground" role="status">{t(`usageBill.${state}`)} {snapshot?.checkedAt && t("usageBill.asOf", { time: new Date(snapshot.checkedAt).toLocaleString(locale) })}</p>
	</section>;
}
