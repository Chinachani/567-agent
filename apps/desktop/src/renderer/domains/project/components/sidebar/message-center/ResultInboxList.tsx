import { useSessionOpener } from "@domains/conversation/hooks/useSessionOpener";
type ResultInboxSnapshot = Awaited<ReturnType<typeof window.agent567.notification.listResults>>;
import { TaskResultListView } from "@vetta-org/theme-ui/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ResultInboxList({ onOpen }: { onOpen: () => void }): JSX.Element {
	const { t } = useTranslation("message");
	const { openSession } = useSessionOpener();
	const [snapshot, setSnapshot] = useState<ResultInboxSnapshot>();
	const [refresh, setRefresh] = useState(0);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			setLoading(true);
			try {
				const result = await window.agent567.notification.listResults();
				if (!disposed) {
					setSnapshot(result);
					setFailed(false);
				}
			} catch {
				if (!disposed) setFailed(true);
			} finally {
				if (!disposed) {
					setLoading(false);
					timer = setTimeout(() => void load(), 15_000);
				}
			}
		};
		void load();
		return () => {
			disposed = true;
			clearTimeout(timer);
		};
	}, [refresh]);
	const tasks = snapshot?.tasks ?? [];
	const open = async (key: string) => {
		const task = tasks.find((item) => item.key === key);
		if (!task || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			await openSession(task.cwd, task.sessionPath);
			await window.agent567.notification.markResultRead(key);
			if (mounted.current) onOpen();
		} catch {
			if (mounted.current) setFailed(true);
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	return (
		<TaskResultListView
			hint={t("results.hint")}
			refreshLabel={t("results.refresh")}
			onRefresh={() => setRefresh((value) => value + 1)}
			loading={loading}
			busy={busy}
			message={
				failed
					? t("results.error")
					: !snapshot && loading
						? t("results.loading")
						: tasks.length === 0
							? t("results.empty")
							: undefined
			}
			notice={
				snapshot?.unavailableCount ? t("results.partial") : snapshot?.truncated ? t("results.limited") : undefined
			}
			openLabel={t("results.open")}
			onOpen={(key) => void open(key)}
			rows={tasks.map((task) => ({
				id: task.key,
				title: task.title || t("results.unnamed"),
				detail: `${t(`results.${task.status}`)} · ${new Date(task.endedAt ?? task.startedAt).toLocaleString()}`,
				unread: !task.read && task.status !== "running",
				unreadLabel: t("results.unread"),
			}))}
		/>
	);
}
