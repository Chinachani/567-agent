import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Preview = { url?: string; unavailable: boolean } | undefined;
/** Each row loads only after becoming visible; decoding remains in main. */
export function AttachmentThumbnail({ id, read }: { id: string; read: (id: string) => Promise<Preview> }) {
	const element = useRef<HTMLSpanElement>(null);
	const [preview, setPreview] = useState<Preview>();
	const { t } = useTranslation("chat");
	useEffect(() => {
		let active = true;
		let started = false;
		setPreview(undefined);
		const load = () => {
			if (started) return;
			started = true;
			void read(id)
				.then((value) => {
					if (active) setPreview(value);
				})
				.catch(() => {
					if (active) setPreview({ unavailable: true });
				});
		};
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				observer.disconnect();
				load();
			}
		});
		if (element.current) observer.observe(element.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [id, read]);
	const url = preview?.url;
	const valid = url && url.length <= 66_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(url);
	return (
		<span
			ref={element}
			className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/40"
		>
			{valid ? (
				<img src={url} alt={t("workbench.thumbnail")} className="h-full w-full object-contain" />
			) : (
				<span
					role="img"
					aria-label={t(preview?.unavailable ? "workbench.thumbnailUnavailable" : "workbench.thumbnail")}
					className={`${preview?.unavailable ? "icon-[solar--gallery-broken-linear]" : "icon-[solar--gallery-linear]"} h-4 w-4 text-muted-foreground`}
				/>
			)}
		</span>
	);
}
