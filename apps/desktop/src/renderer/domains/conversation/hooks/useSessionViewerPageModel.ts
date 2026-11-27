import {
	activityPanelOpenAtom,
	type ChatConversationItem,
	type ConversationDeliveryIndex,
	type ConversationFeedIdentity,
	closeInlineFilePreviewAtom,
	createConversationDeliveryIndex,
	defaultImConversationCwdAtom,
	inlineFilePreviewContextReadonlyAtom,
	knowledgeProcessingCwdAtom,
	pendingScrollToEntryAtom,
} from "@shared/store/atoms";
import { useParams } from "@tanstack/react-router";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fullHistoryToChat } from "../services/chat-service";

/**
 * 判断 filePath 是否位于 dir 目录之下，分隔符无关（Windows 上 session path 用反斜杠、
 * 手动拼 `dir + "/"` 前缀会因 `\` vs `/` 匹配失败，导致 KB/IM 面板判定为 false）。
 */
function isPathUnderDir(filePath: string, dir: string): boolean {
	if (!filePath || !dir) return false;
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	return `${norm(filePath)}/`.startsWith(`${norm(dir)}/`);
}

export interface SessionViewerPageModel {
	path: string;
	error: string | null;
	messages: ChatConversationItem[];
	deliveryIndex: ConversationDeliveryIndex;
	initialTargetKey?: string;
	onInitialTargetHandled: () => void;
	exporting: boolean;
	exportTitle: string;
	isKnowledge: boolean;
	isIm: boolean;
	cwd: string | null;
	panelOpen: boolean;
	emptyPathLabel: string;
	errorPrefix: string;
	onStartExport: () => void;
	onTogglePanel: () => void;
	onExportFinished: () => void;
}

interface ViewerSnapshot {
	scope: ConversationFeedIdentity;
	messages: ChatConversationItem[];
	error: string | null;
}

const EMPTY_MESSAGES: ChatConversationItem[] = [];

export function useSessionViewerPageModel(): SessionViewerPageModel {
	const { t } = useTranslation("chat");
	const params = useParams({ strict: false }) as { path?: string };
	const encodedPath = params.path as string | undefined;
	const path = encodedPath ? decodeURIComponent(encodedPath) : "";

	const { initialSnapshot, snapshotAtom } = useMemo(() => {
		const initialSnapshot: ViewerSnapshot = {
			scope: { runtimeId: null, sessionPath: path },
			messages: EMPTY_MESSAGES,
			error: null,
		};
		return { initialSnapshot, snapshotAtom: atom(initialSnapshot) };
	}, [path]);
	const [snapshot, setSnapshot] = useAtom(snapshotAtom);
	const [pendingTarget, setPendingTarget] = useAtom(pendingScrollToEntryAtom);
	const viewerTarget =
		pendingTarget?.scope?.runtimeId === null && pendingTarget.scope.sessionPath === path ? pendingTarget : null;
	const handleTarget = useCallback(
		() => setPendingTarget((current) => (current === viewerTarget ? null : current)),
		[setPendingTarget, viewerTarget],
	);
	const [exporting, setExporting] = useState(false);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const kbCwd = useAtomValue(knowledgeProcessingCwdAtom);
	const [panelOpen, setPanelOpen] = useAtom(activityPanelOpenAtom);
	const inlinePreviewCtx = useAtomValue(inlineFilePreviewContextReadonlyAtom);
	const inlinePreviewActive = inlinePreviewCtx !== null;
	const closeInlinePreview = useSetAtom(closeInlineFilePreviewAtom);
	const isIm = useMemo(() => isPathUnderDir(path, imCwd), [path, imCwd]);
	const exportTitle = useMemo(() => {
		const fileName = path.split(/[\\/]/).at(-1) ?? t("sessionViewer.export.defaultTitle");
		return fileName.replace(/\.jsonl$/i, "");
	}, [path, t]);
	const handleStartExport = useCallback(() => setExporting(true), []);
	const handleExportFinished = useCallback(() => setExporting(false), []);
	const isKnowledge = useMemo(() => isPathUnderDir(path, kbCwd), [path, kbCwd]);
	const cwd = isKnowledge ? kbCwd : isIm ? imCwd : null;
	const deliveryIndex = useMemo(
		() =>
			createConversationDeliveryIndex(
				atom((get) => {
					const { scope, messages } = get(snapshotAtom);
					return { scope, cwd, messages };
				}),
			),
		[cwd, snapshotAtom],
	);

	const handleTogglePanel = useCallback(() => {
		if (inlinePreviewActive) {
			closeInlinePreview();
			setPanelOpen(false);
			return;
		}
		setPanelOpen((o) => !o);
	}, [inlinePreviewActive, closeInlinePreview, setPanelOpen]);

	useEffect(() => {
		if (!path) return;
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;

		(async () => {
			try {
				const initial = await window.agent567.session.openViewer(path);
				if (cancelled) return;
				setSnapshot({ ...initialSnapshot, messages: fullHistoryToChat(initial.history) });

				unsubscribe = await window.agent567.session.subscribeViewer(path, (snapshot) => {
					if (!cancelled) setSnapshot({ ...initialSnapshot, messages: fullHistoryToChat(snapshot.history) });
				});
				if (cancelled) unsubscribe?.();
			} catch (err) {
				if (!cancelled)
					setSnapshot((current) => ({
						...current,
						error: (err as Error).message,
					}));
			}
		})();

		return () => {
			cancelled = true;
			setSnapshot(initialSnapshot);
			unsubscribe?.();
		};
	}, [initialSnapshot, path, setSnapshot]);

	return {
		path,
		error: snapshot.error,
		messages: snapshot.messages,
		deliveryIndex,
		initialTargetKey: viewerTarget?.entryId,
		onInitialTargetHandled: handleTarget,
		exporting,
		exportTitle,
		isKnowledge,
		isIm,
		cwd,
		panelOpen,
		emptyPathLabel: t("sessionViewer.emptyState.noPath"),
		errorPrefix: t("sessionViewer.error.loadPrefix"),
		onStartExport: handleStartExport,
		onTogglePanel: handleTogglePanel,
		onExportFinished: handleExportFinished,
	};
}
