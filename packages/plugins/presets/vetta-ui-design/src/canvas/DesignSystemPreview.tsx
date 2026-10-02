import { memo, useEffect, useMemo, useState } from "react";
import { parsePreviewTokens, tint } from "../design-systems/preview-tokens";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";

const coverRequests = new Map<string, Promise<string | null>>();
const MAX_CACHED_COVERS = 16;
const MAX_COVER_BYTES_BASE64 = 700_000;

function loadCover(url: string): Promise<string | null> {
	const cached = coverRequests.get(url);
	if (cached) {
		coverRequests.delete(url);
		coverRequests.set(url, cached);
		return cached;
	}
	const request = getPluginCtx()
		.network.request<string>({ url, method: "GET", responseType: "base64", timeoutMs: 10_000 })
		.then((response) => {
			const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
			const mime = contentType?.split(";")[0]?.trim().toLowerCase();
			if (
				!response.ok ||
				typeof response.body !== "string" ||
				response.body.length === 0 ||
				response.body.length > MAX_COVER_BYTES_BASE64 ||
				!mime ||
				!["image/svg+xml", "image/png", "image/jpeg", "image/webp"].includes(mime)
			) {
				return null;
			}
			return `data:${mime};base64,${response.body}`;
		})
		.catch(() => null);
	coverRequests.set(url, request);
	while (coverRequests.size > MAX_CACHED_COVERS) {
		const oldest = coverRequests.keys().next().value;
		if (oldest === undefined) break;
		coverRequests.delete(oldest);
	}
	return request;
}

/**
 * 一张通用产品界面缩略图：顶栏 + 侧栏 + 统计卡 + 主按钮 + 列表行。
 * 所有颜色/圆角/阴影都取自该体系的 theme.css（单一真源），Tailwind 只负责布局
 * ——动态值走 inline style，JIT 扫不到运行期字符串。
 * className 可覆盖尺寸（默认 164px 定高，宫格里传 aspect 比例自适应列宽）。
 *
 * memo 是它的使用前提：这是几十个带 inline style 的节点，而它挂在风格墙上——一屏 25 张卡，
 * 外层任何一次状态变化（悬停哪张、卡片尺寸变化）都会把这棵树重建 25 遍。props 只有
 * `system`（引用稳定）与 `className`（常量），浅比较足够。
 */
export const DesignSystemPreview = memo(function DesignSystemPreview({
	system,
	className,
}: {
	system: DesignSystem;
	className?: string;
}) {
	const coverUrl = system.resources.find((resource) => resource.role === "cover" && resource.encoding === "binary");
	const [cover, setCover] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		setCover(null);
		if (coverUrl?.encoding === "binary") {
			void loadCover(coverUrl.url).then((source) => {
				if (active) setCover(source);
			});
		}
		return () => {
			active = false;
		};
	}, [coverUrl]);
	const tokens = useMemo(() => parsePreviewTokens(system.themeCss), [system.themeCss]);
	const { colors, radius, shadow } = tokens;
	const fg = colors["surface-foreground"];
	const raised = colors["surface-raised"] ?? colors.surface;
	const border = colors.border ?? tint(colors.muted, 30);
	/** 预览是 ~240px 的缩略图，radius 原值会失真地大，按一半呈现质感差异。 */
	const r = (name: string, fallback: string): string => {
		const raw = radius[name];
		const value = raw ? Number.parseFloat(raw) : Number.NaN;
		return Number.isFinite(value) ? `${Math.round(value / 2)}px` : fallback;
	};

	return (
		<div
			className={`pointer-events-none relative flex w-full select-none flex-col overflow-hidden border ${className ?? "h-[164px]"}`}
			style={{ background: colors.surface, borderColor: border, borderRadius: r("xl", "8px") }}
		>
			{cover ? (
				<img
					src={cover}
					alt=""
					className="absolute inset-0 size-full object-cover"
					onError={() => setCover(null)}
				/>
			) : (
				<>
			{/* 顶栏：窗口点 + 搜索框 */}
			<div
				className="flex h-7 shrink-0 items-center gap-1.5 border-b px-2"
				style={{ background: raised, borderColor: border }}
			>
				<span className="size-1.5 rounded-full" style={{ background: tint(colors.muted, 45) }} />
				<span className="size-1.5 rounded-full" style={{ background: tint(colors.muted, 45) }} />
				<div
					className="ml-1 h-3.5 flex-1 border"
					style={{ background: colors.surface, borderColor: border, borderRadius: r("md", "3px") }}
				/>
			</div>
			<div className="flex min-h-0 flex-1">
				{/* 侧栏：一条激活项 + 两条普通项 */}
				<div
					className="flex w-11 shrink-0 flex-col gap-1 border-r p-1.5"
					style={{ background: raised, borderColor: border }}
				>
					<div
						className="flex h-3 items-center gap-0.5 px-0.5"
						style={{ background: tint(colors.primary, 18), borderRadius: r("sm", "2px") }}
					>
						<span className="size-1 rounded-full" style={{ background: colors.primary }} />
					</div>
					<div className="h-3" style={{ background: tint(colors.muted, 18), borderRadius: r("sm", "2px") }} />
					<div className="h-3" style={{ background: tint(colors.muted, 18), borderRadius: r("sm", "2px") }} />
				</div>
				{/* 主区：标题 + 主按钮 → 统计卡 ×2 → 列表行 ×3 */}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-bold leading-none" style={{ color: fg }}>
							Aa
						</span>
						<div
							className="flex h-4 w-9 items-center justify-center"
							style={{ background: colors.primary, borderRadius: r("lg", "4px"), boxShadow: shadow.sm }}
						>
							<span
								className="h-1 w-4 rounded-full"
								style={{ background: colors["primary-foreground"] ?? "#fff" }}
							/>
						</div>
					</div>
					<div className="flex gap-1.5">
						{[colors.primary, colors.accent].map((bar, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: 两张静态占位卡
								key={index}
								className="flex-1 border p-1"
								style={{
									background: raised,
									borderColor: border,
									borderRadius: r("lg", "4px"),
									boxShadow: shadow.sm,
								}}
							>
								<div
									className="mb-1 h-1 w-6 rounded-full"
									style={{ background: tint(colors.muted, 45) }}
								/>
								<div className="h-1.5 w-9 rounded-full" style={{ background: bar }} />
							</div>
						))}
					</div>
					<div className="flex min-h-0 flex-1 flex-col justify-end gap-1">
						{[colors.accent, colors.primary, colors.danger].map((dot, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 三条静态占位行
							<div key={index} className="flex items-center gap-1">
								<span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
								<span
									className="h-1 flex-1 rounded-full"
									style={{ background: tint(colors.muted, 28) }}
								/>
								<span
									className="h-1 w-5 shrink-0 rounded-full"
									style={{ background: tint(colors.muted, 16) }}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
				</>
			)}
		</div>
	);
})
