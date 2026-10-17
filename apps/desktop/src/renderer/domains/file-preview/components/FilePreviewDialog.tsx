import { useThemeComponent } from "@vetta-org/theme-sdk";
import { Dialog } from "radix-ui";
import { useRef } from "react";
import { useFilePreviewDialogModel } from "../hooks/useFilePreviewDialogModel";
import { FilePreviewDialogView } from "./FilePreviewDialogView";

export function FilePreviewDialog(): JSX.Element {
	const model = useFilePreviewDialogModel();
	const previousFocus = useRef<HTMLElement | null>(null);
	const ThemedFilePreviewDialogView = useThemeComponent("root.filePreviewDialogView", FilePreviewDialogView);
	return (
		<Dialog.Root
			open={model.item !== null}
			onOpenChange={(open) => {
				if (!open) model.onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="no-drag fixed inset-0 z-50 bg-background/95" />
				<Dialog.Content
					className="no-drag fixed inset-0 z-50 outline-none"
					aria-describedby={undefined}
					onOpenAutoFocus={() => {
						previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (previousFocus.current?.isConnected) previousFocus.current.focus();
					}}
				>
					<Dialog.Title className="sr-only">{model.item?.name}</Dialog.Title>
					<ThemedFilePreviewDialogView {...model} />
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
