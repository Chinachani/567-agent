import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { activeSessionAtom } from "@shared/store/atoms";
import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createClipboardInsertionParts } from "../clipboard-message-parts";
import { insertClipboardMessage } from "../clipboard-message";
import { $insertInputParts } from "../inputEditorHandle";
import { persistBase64Images, persistImageFiles } from "../persistImages";
import {
	type ClipboardImages,
	readClipboardImageFiles,
	readClipboardImages,
} from "./clipboard-images";

/**
 * 粘贴图片 → 立即落盘 → 插入行内缩略图 token。Vetta 富消息剪贴板还会
 * 恢复正文并用新落盘路径替换旧图片 token；纯文本仍走 Lexical 默认实现。
 */
export function PasteImagePlugin({
	runtimeId,
	local = false,
}: {
	readonly runtimeId?: string | null;
	readonly local?: boolean;
} = {}): null {
	const [editor] = useLexicalComposerContext();
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const effectiveRuntimeId = runtimeId === undefined ? activeSession?.runtimeId ?? null : runtimeId;

	useEffect(() => {
		const insert = (text: string, paths: readonly string[]): void => {
			if (!local) {
				insertClipboardMessage(text, paths);
				return;
			}
			editor.update(() => $insertInputParts(createClipboardInsertionParts(text, paths)));
		};
		const persistClipboardImages = (clipboardImages: ClipboardImages): void => {
			const persist =
				clipboardImages.kind === "vetta-message"
					? persistBase64Images(clipboardImages.images, effectiveRuntimeId, "paste")
					: persistImageFiles(clipboardImages.files, effectiveRuntimeId, "paste");
			void persist
				.then((paths) => {
					if (clipboardImages.kind === "vetta-message") {
						insert(clipboardImages.messageText, paths);
					} else {
						insert("", paths);
					}
				})
				.catch((error: unknown) => {
					console.warn("[input-editor] pasted image could not be saved:", error);
					if (clipboardImages.kind === "vetta-message") insert(clipboardImages.messageText, []);
					showToast({ variant: "error", message: t("dropZone.failed") });
				});
		};

		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!("clipboardData" in event) || !event.clipboardData) return false;
				const nativeImageFiles = readClipboardImageFiles(event.clipboardData);
				if (nativeImageFiles.length > 0) {
					event.preventDefault();
					let fallbackText = "";
					try {
						fallbackText = event.clipboardData.getData("text/plain") || "";
					} catch (error) {
						console.warn("[input-editor] clipboard text read failed:", error);
					}
					void window.vetta.clipboard
						.pasteUserMessage(effectiveRuntimeId ?? "draft")
						.catch((error: unknown) => {
							console.warn("[input-editor] rich clipboard paste failed:", error);
							return null;
						})
						.then((richMessage) => {
							if (!richMessage) {
								void persistImageFiles(nativeImageFiles, effectiveRuntimeId, "paste")
									.then((paths) => insert(fallbackText, paths))
									.catch((error: unknown) => {
										console.warn("[input-editor] clipboard fallback paste failed:", error);
										insert(fallbackText, []);
										showToast({ variant: "error", message: t("dropZone.failed") });
									});
								return;
							}
							recordInputImagesAdded("paste", richMessage.images);
							insert(
								richMessage.text,
								richMessage.images.map((image) => image.path),
							);
						});
					return true;
				}
				const clipboardImages = readClipboardImages(event.clipboardData);
				const hasImages =
					clipboardImages.kind === "vetta-message"
						? clipboardImages.images.length > 0
						: clipboardImages.files.length > 0;
				if (!hasImages) return false;
				event.preventDefault();
				persistClipboardImages(clipboardImages);
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [editor, effectiveRuntimeId, local, t]);

	return null;
}
