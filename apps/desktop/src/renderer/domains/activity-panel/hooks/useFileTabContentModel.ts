import { usePreviewNav } from "@domains/file-preview/components/FilePreviewView";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { revealFileExplorerPath } from "@shared/lib/file-explorer-host";
import {
	activityPanelPreviewAvailableAtom,
	closeInlineFilePreviewAtom,
	type FilePreviewContext,
	type FilePreviewItem,
	inlineFilePreviewAtom,
	inlineFilePreviewContextReadonlyAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const TREE_DEFAULT_WIDTH = 220;
const TREE_MIN_WIDTH = 160;
const TREE_MAX_WIDTH = 360;
const PREVIEW_MOUNT_DELAY_MS = 240;

export interface FileTabContentModel {
	showTree: boolean;
	showPreview: boolean;
	treeWidth: number;
	treeCollapsed: boolean;
	previewMounted: boolean;
	previewCtx: FilePreviewContext | null;
	canPrev: boolean;
	canNext: boolean;
	onTreeResize: (delta: number) => void;
	toggleTree: () => void;
	locate: (item: FilePreviewItem) => void;
	goPrev: () => void;
	goNext: () => void;
	closePreview: () => void;
}

export function useFileTabContentModel(): FileTabContentModel {
	const { t } = useTranslation("chat");
	const alive = useRef(false);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const [previewCtx, setPreviewCtx] = useAtom(inlineFilePreviewContextReadonlyAtom);
	const setPreview = useSetAtom(inlineFilePreviewAtom);
	const closePreview = useSetAtom(closeInlineFilePreviewAtom);
	const previewAvailable = useAtomValue(activityPanelPreviewAvailableAtom);
	const { goPrev, goNext } = usePreviewNav((updater) => {
		if (typeof updater === "function") {
			setPreviewCtx(updater(previewCtx));
		} else {
			setPreview(updater);
		}
	});
	const onClosePreview = useCallback(() => closePreview(), [closePreview]);

	const showPreview = previewCtx !== null && previewAvailable;
	const [previewMounted, setPreviewMounted] = useState(false);
	useEffect(() => {
		if (!showPreview) {
			setPreviewMounted(false);
			return;
		}
		const timer = setTimeout(() => setPreviewMounted(true), PREVIEW_MOUNT_DELAY_MS);
		return () => clearTimeout(timer);
	}, [showPreview]);

	const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
	const onTreeResize = useCallback((delta: number) => {
		setTreeWidth((currentWidth) => Math.max(TREE_MIN_WIDTH, Math.min(TREE_MAX_WIDTH, currentWidth + delta)));
	}, []);

	const [treeCollapsed, setTreeCollapsed] = useState(false);
	const toggleTree = useCallback(() => setTreeCollapsed((collapsed) => !collapsed), []);
	const locate = useCallback(
		(item: FilePreviewItem) => {
			if (!item.path) return;
			const path = item.path;
			const run = () => {
				if (!alive.current) return;
				void revealFileExplorerPath(path, { select: true, focus: true }).catch(() => {
					if (alive.current) showToast({ variant: "error", message: t("fileEditor.locateFailed") });
				});
			};
			if (!treeCollapsed) {
				run();
				return;
			}
			// 目录树收起时 FilesPanel 未挂载，先展开，等它绑定完成再定位。
			setTreeCollapsed(false);
			void waitForCommittedPaint().then(run);
		},
		[treeCollapsed, t],
	);
	useEffect(() => {
		if (!showPreview) setTreeCollapsed(false);
	}, [showPreview]);

	useEffect(() => () => closePreview(), [closePreview]);

	return {
		showTree: !showPreview || !treeCollapsed,
		showPreview,
		treeWidth,
		treeCollapsed,
		previewMounted,
		previewCtx,
		canPrev: previewCtx !== null && previewCtx.index > 0,
		canNext: previewCtx !== null && previewCtx.index < previewCtx.items.length - 1,
		onTreeResize,
		toggleTree,
		locate,
		goPrev,
		goNext,
		closePreview: onClosePreview,
	};
}
