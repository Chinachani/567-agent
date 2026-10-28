import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	conversationDeliveriesAtom,
	conversationDeliveriesStateAtom,
	pendingScrollToEntryAtom,
	refreshConversationDeliveriesAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { ConversationDeliveriesView } from "@vetta-org/theme-ui/activity";
import { MarkdownHostProvider } from "@vetta-org/theme-ui/markdown";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useActivityWorkspace } from "../registry/context";

export function ConversationDeliveries() {
	const { t } = useTranslation("chat");
	const workspace = useActivityWorkspace();
	const session = useAtomValue(activeSessionAtom);
	const all = useAtomValue(conversationDeliveriesAtom);
	const state = useAtomValue(conversationDeliveriesStateAtom);
	const retry = useSetAtom(refreshConversationDeliveriesAtom);
	const items = session && workspace.runtimeIds.includes(session.runtimeId) ? all : [];
	const markdown = useRendererMarkdownModel(workspace.cwd, false, workspace.id);
	const setTarget = useSetAtom(pendingScrollToEntryAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const narrow = useNarrowScreen();
	const open = useCallback(
		(id: string) => {
			const item = items.find((entry) => entry.id === id);
			if (!item) return;
			if (item.kind === "url") markdown.onOpenUrl(item.target);
			else if (item.kind === "image" && /^https?:\/\//i.test(item.target))
				markdown.host?.openImage?.(item.target, item.label);
			else markdown.onOpenFile(item.target);
		},
		[items, markdown],
	);
	const source = useCallback(
		(id: string) => {
			const item = items.find((entry) => entry.id === id);
			if (!item) return;
			setTarget({ entryId: item.messageId });
			if (narrow) setPanelOpen(false);
		},
		[items, narrow, setTarget, setPanelOpen],
	);
	const copy = useCallback(
		(id: string) => {
			const item = items.find((entry) => entry.id === id);
			if (!item) return;
			void markdown.host
				?.copyText?.(item.target, /^https?:\/\//i.test(item.target) ? "url" : "file")
				.catch(() => showToast({ variant: "error", message: t("deliveries.copyFailed") }));
		},
		[items, markdown.host, t],
	);
	return (
		<MarkdownHostProvider host={markdown.host}>
			<ConversationDeliveriesView
				key={session?.runtimeId}
				items={items.map((item) => ({ ...item, evidenceLabel: t(`deliveries.evidence.${item.evidence}`) }))}
				state={session && workspace.runtimeIds.includes(session.runtimeId) ? state : "ready"}
				labels={{
					title: t("deliveries.title"),
					description: t("deliveries.description"),
					empty: t("deliveries.empty"),
					source: t("deliveries.source"),
					filters: {
						all: t("deliveries.filters.all"),
						file: t("deliveries.filters.file"),
						url: t("deliveries.filters.url"),
						image: t("deliveries.filters.image"),
					},
					noMatches: t("deliveries.noMatches"),
					resources: markdown.labels,
					open: t("deliveries.open"),
					loading: t("deliveries.loading"),
					failed: t("deliveries.failed"),
					retry: t("deliveries.retry"),
				}}
				onOpen={open}
				onSource={source}
				onCopy={copy}
				onRetry={retry}
			/>
		</MarkdownHostProvider>
	);
}
