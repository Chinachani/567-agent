import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("zh-CN", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function formatRelativeTime(timestamp: number, now: number): string | null {
	const diffMinutes = Math.floor((now - timestamp) / 60000);
	if (diffMinutes < 5) return null;
	if (diffMinutes < 60) return `${diffMinutes}分钟前`;
	if (diffMinutes < 120) {
		const minutes = diffMinutes % 60;
		return minutes > 0 ? `1小时${minutes}分钟前` : "1小时前";
	}
	if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}小时前`;
	return `${Math.floor(diffMinutes / 1440)}天前`;
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}秒`;
	return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
}

export function RelativeTimeLabel({ endedAt }: { endedAt: number }): JSX.Element | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30000);
		return () => window.clearInterval(timer);
	}, []);
	const label = formatRelativeTime(endedAt, now);
	if (!label) return null;
	return (
		<span className="text-[11px] text-muted-foreground/40" title={formatTime(endedAt)}>
			{label}
		</span>
	);
}

export interface CopyButtonLabels {
	readonly copy: string;
	readonly copied: string;
	readonly failed?: string;
}

export function CopyButton({
	getText,
	onCopy,
	labels,
}: {
	getText: () => string;
	onCopy?: () => void | Promise<void>;
	labels: CopyButtonLabels;
}): JSX.Element {
	const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
	const timer = useRef<number | undefined>(undefined);
	const sequence = useRef(0);
	useEffect(
		() => () => {
			sequence.current++;
			window.clearTimeout(timer.current);
		},
		[],
	);
	const onClick = useCallback(async () => {
		const attempt = ++sequence.current;
		let result: "copied" | "failed";
		try {
			if (onCopy) await onCopy();
			else {
				const text = getText();
				if (!text) return;
				await navigator.clipboard.writeText(text);
			}
			result = "copied";
		} catch {
			result = "failed";
		}
		if (attempt !== sequence.current) return;
		window.clearTimeout(timer.current);
		setStatus(result);
		timer.current = window.setTimeout(() => setStatus("idle"), result === "failed" ? 4000 : 1500);
	}, [getText, onCopy]);
	const label =
		status === "copied" ? labels.copied : status === "failed" ? (labels.failed ?? labels.copy) : labels.copy;
	return (
		<>
			<button
				type="button"
				onClick={onClick}
				title={label}
				aria-label={label}
				className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground"
			>
				<span
					aria-hidden="true"
					className={cn(
						"h-3.5 w-3.5",
						status === "copied"
							? "icon-[mdi--check]"
							: status === "failed"
								? "icon-[mdi--alert-circle-outline]"
								: "icon-[solar--copy-linear]",
					)}
				/>
			</button>
			{status === "failed" && labels.failed && (
				<span className="text-xs text-muted-foreground" role="status">
					{labels.failed}
				</span>
			)}
		</>
	);
}
