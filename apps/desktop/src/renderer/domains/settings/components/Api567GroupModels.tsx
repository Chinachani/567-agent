import { Button } from "@shared/components/ui/button";
import { useTranslation } from "react-i18next";

export function Api567GroupModels({
	models,
	imageModels,
	selectedChatModel,
	onSelectChat,
	selectedImageModel,
	onSelectImage,
	busy,
}: {
	models: readonly string[];
	imageModels: readonly string[];
	selectedChatModel?: string;
	onSelectChat: (model: string) => void;
	selectedImageModel?: string;
	onSelectImage: (model: string) => void;
	busy: boolean;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const images = [...new Set(imageModels)];
	const imageSet = new Set(images);
	const chat = [...new Set(models)].filter((id) => !imageSet.has(id));
	return (
		<div className="mt-4 space-y-4 border-t border-border/50 pt-4">
			{chat.length > 0 && (
				<section aria-label={t("api567Models.chat")}>
					<p className="mb-2 text-[11px] text-muted-foreground">
						{t("api567Models.chat")} · {chat.length}
					</p>
					<div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
						{chat.map((id) => (
							<Button
								key={id}
								size="sm"
								variant="ghost"
								disabled={busy}
								aria-pressed={selectedChatModel === id}
								onClick={() => onSelectChat(id)}
								className="h-auto max-w-full gap-1.5 whitespace-normal break-all rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-left font-mono text-[11px] aria-pressed:bg-chat-accent/15 aria-pressed:text-chat-accent aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-chat-accent/40 aria-pressed:hover:bg-chat-accent/20 aria-pressed:hover:text-chat-accent"
							>
								{selectedChatModel === id && (
									<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
								)}
								{id}
							</Button>
						))}
					</div>
					<p className="mt-2 text-[11px] text-muted-foreground">{t("api567Models.chatHint")}</p>
				</section>
			)}
			{images.length > 0 && (
				<section aria-label={t("api567Models.images")}>
					<p className="mb-2 text-[11px] text-muted-foreground">
						{t("api567Models.images")} · {images.length}
					</p>
					<div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
						{images.map((id) => (
							<Button
								key={id}
								size="sm"
								variant="ghost"
								disabled={busy}
								aria-pressed={selectedImageModel === id}
								onClick={() => onSelectImage(id)}
								className="h-auto max-w-full gap-1.5 whitespace-normal break-all rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-left font-mono text-[11px] aria-pressed:bg-image-accent/15 aria-pressed:text-image-accent aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-image-accent/40 aria-pressed:hover:bg-image-accent/20 aria-pressed:hover:text-image-accent"
							>
								{selectedImageModel === id && (
									<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
								)}
								{id}
							</Button>
						))}
					</div>
					<p className="mt-2 text-[11px] text-muted-foreground">{t("api567Models.imageHint")}</p>
				</section>
			)}
		</div>
	);
}
