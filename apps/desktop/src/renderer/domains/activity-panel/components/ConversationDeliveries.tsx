import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import {
	activityPanelOpenAtom,
	emptyConversationDeliveryIndex,
	pendingScrollToEntryAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { ConversationDeliveriesView } from "@vetta-org/theme-ui/activity";
import { MarkdownHostProvider } from "@vetta-org/theme-ui/markdown";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useActivityPanelContext } from "../registry/context";

export function ConversationDeliveries() {
	const { t } = useTranslation("chat");
	const { workspace, deliveryIndex = emptyConversationDeliveryIndex } = useActivityPanelContext();
	const store = useStore();
	const result = useAtomValue(deliveryIndex.state);
	const retry = useSetAtom(deliveryIndex.refresh);
	const { scope } = result;
	const inScope = scope && (scope.runtimeId === null || workspace.runtimeIds.includes(scope.runtimeId));
	const items = inScope ? result.data : [];
	const markdown = useRendererMarkdownModel(workspace.cwd, false, workspace.id);
	const setTarget = useSetAtom(pendingScrollToEntryAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const narrow = useNarrowScreen();
	const findCurrentItem = useCallback(
		(id: string) => store.get(deliveryIndex.state) === result ? items.find((entry) => entry.id === id) : undefined,
		[deliveryIndex.state, items, result, store],
	);
	const open = useCallback(
		(id: string) => {
			const item = findCurrentItem(id);
			if (!item) return;
			if (item.kind === "url") markdown.onOpenUrl(item.target);
			else if (item.kind === "image" && /^https?:\/\//i.test(item.target))
				markdown.host?.openImage?.(item.target, item.label);
			else markdown.onOpenFile(item.target);
		},
		[findCurrentItem, markdown],
	);
	const source = useCallback(
		(id: string) => {
			const item = findCurrentItem(id);
			if (!scope || !item) return;
			setTarget({ entryId: item.messageId, scope: { sessionPath: scope.sessionPath, runtimeId: scope.runtimeId } });
			if (narrow) setPanelOpen(false);
		},
		[findCurrentItem, narrow, scope, setTarget, setPanelOpen],
	);
	const copy = useCallback(
		async (id: string) => {
			const item = findCurrentItem(id);
			try {
				if (!item || !markdown.host?.copyText) throw new Error("Delivery copy is unavailable");
				await markdown.host.copyText(item.target, /^https?:\/\//i.test(item.target) ? "url" : "file");
			} catch (error) {
				showToast({ variant: "error", message: t("deliveries.copyFailed") });
				throw error;
			}
		},
		[findCurrentItem, markdown.host, t],
	);
	return (
		<MarkdownHostProvider host={markdown.host}>
			<ConversationDeliveriesView
				key={scope ? JSON.stringify([scope.runtimeId, scope.sessionPath]) : undefined}
				items={items.map((item) => ({ ...item, evidenceLabel: t(`deliveries.evidence.${item.evidence}`) }))}
				state={inScope ? result.state : "ready"}
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
