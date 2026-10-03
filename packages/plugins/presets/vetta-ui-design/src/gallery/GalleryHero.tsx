import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCatalogState } from "../design-systems/index";
import { SHARE_EXTENSION } from "../export/share-format";
import { HeroArtwork } from "./HeroArtwork";

/**
 * 画廊首页的 Hero。搜索与分类筛选由滚动时固定的 GalleryView 工具条承载。
 *
 * 首页不再往宿主页头塞控件；创建、导入和刷新仍放在 Hero，搜索与分类筛选固定在内容顶部。
 * 「全部设计」列表页复用同一条固定工具栏，宿主页头只保留返回和窗口拖拽区。
 *
 * 不做成卡片：Hero 是页面本身的顶部，加了圆角描边就变成「页面里的一个控件」。
 * 层次全部由光晕、点阵与底部发丝线承担。
 */
export interface GalleryHeroProps {
	/** 一张卡 = 一个项目。 */
	projectCount: number;
	/** 所有项目里的设计份数之和。 */
	designCount: number;
	empty: boolean;
	loading: boolean;
	busy: boolean;
	onRefresh: () => void;
	onImport: () => void;
	onCreate: () => void;
	onBrowseStyles: () => void;
}

export function GalleryHero({
	projectCount,
	designCount,
	empty,
	loading,
	busy,
	onRefresh,
	onImport,
	onCreate,
	onBrowseStyles,
}: GalleryHeroProps) {
	const { t } = useTranslation();
	const { systems } = useCatalogState();

	const stats = [
		...(empty
			? []
			: [
					t("gallery.hero.stat.projects", { count: projectCount }),
					t("gallery.hero.stat.designs", { count: designCount }),
				]),
		...(systems.length > 0 ? [t("gallery.hero.stat.styles", { count: systems.length })] : []),
	];

	return (
		// -mx-5 让光晕与发丝线通版铺到内容区两侧，Hero 因此是「页面顶部」而不是页面里的一块卡片
		<section className="vetd-hero relative isolate -mx-5 mb-7 overflow-hidden px-5 pb-6 pt-6">
			<div className="vetd-hero-glow pointer-events-none absolute inset-0 -z-10" aria-hidden />
			<div className="vetd-hero-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
			{/* 插画在窄屏直接不渲染：挤到文字上会两边都难看。整幅收在 Hero 内，
			    顶端不许伸出去被裁——硬裁切线在页头交界处非常显眼 */}
			<HeroArtwork className="pointer-events-none absolute -right-4 bottom-1 -z-10 hidden h-[88%] w-auto lg:block" />

			<div className="max-w-2xl">
				<h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
					{t("gallery.hero.title")}
				</h1>
				<p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
					{t(empty ? "gallery.hero.subtitle.empty" : "gallery.hero.subtitle", { ext: SHARE_EXTENSION })}
				</p>

				<div className="mt-5 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onCreate}
						disabled={busy}
						className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
					>
						<svg
							viewBox="0 0 24 24"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							aria-hidden
						>
							<path d="M12 5v14M5 12h14" strokeLinecap="round" />
						</svg>
						{t("gallery.hero.create")}
					</button>
					<button
						type="button"
						onClick={onImport}
						disabled={busy}
						className="vetd-hero-field flex h-9 items-center rounded-xl px-3.5 text-xs text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40"
					>
						{t("gallery.action.import")}
					</button>
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading}
						aria-label={t("gallery.action.refresh")}
						title={t("gallery.action.refresh")}
						className="vetd-hero-field flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-40"
					>
						<svg
							viewBox="0 0 24 24"
							className={`size-4 ${loading ? "animate-spin" : ""}`}
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden
						>
							<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
					<button
						type="button"
						onClick={onBrowseStyles}
						className="group flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{t("gallery.hero.browseStyles")}
						<svg
							viewBox="0 0 24 24"
							className="size-3 transition-transform duration-200 group-hover:translate-y-0.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden
						>
							<path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				</div>

				{stats.length > 0 ? (
					<ul className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
						{stats.map((stat, index) => (
							<li key={stat} className="flex items-center gap-2 tabular-nums">
								{index > 0 ? <span aria-hidden className="size-1 rounded-full bg-current opacity-40" /> : null}
								{stat}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</section>
	);
}
