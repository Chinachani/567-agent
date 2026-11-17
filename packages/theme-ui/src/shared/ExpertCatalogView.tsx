import { Button } from "@vetta-org/ui";
import { useState, type JSX } from "react";
import { ListPagination, type ListPaginationLabels } from "./ListPagination";
import { useListPagination } from "./useListPagination";

export type ExpertCatalogTab = "experts" | "collaboration";
export interface ExpertCatalogCard {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly avatar?: string;
	readonly category: string;
	readonly categoryLabel: string;
	readonly sourceLabel: string;
	readonly abilityLabel: string;
	readonly workflow: readonly string[];
	readonly unavailableReason?: string;
	readonly favorite?: boolean;
	readonly recentIndex?: number;
}
export interface ExpertCatalogProject {
	readonly cwd: string;
	readonly name: string;
	readonly sessionLabel: string;
}
export interface ExpertCatalogSourceStatus {
	readonly name: string;
	readonly message: string;
	readonly updatedAt?: string;
	readonly refreshing: boolean;
	readonly refreshLabel: string;
}
export interface ExpertCatalogViewProps {
	readonly sourceStatus?: ExpertCatalogSourceStatus;
	readonly onRefreshSource?: () => void;
	readonly tab: ExpertCatalogTab;
	readonly title: string;
	readonly subtitle: string;
	readonly tabs: readonly { readonly id: ExpertCatalogTab; readonly label: string }[];
	readonly experts: readonly ExpertCatalogCard[];
	readonly projects: readonly ExpertCatalogProject[];
	readonly categories: readonly { readonly id: string; readonly label: string }[];
	readonly labels: {
		readonly create: string;
		readonly use: string;
		readonly copy: string;
		readonly details: string;
		readonly expertsEmpty: string;
		readonly collaborationHint: string;
		readonly projectsEmpty: string;
		readonly newProject: string;
		readonly openProject: string;
		readonly expertSearch: string;
		readonly projectSearch: string;
		readonly category: string;
		readonly allCategories: string;
		readonly noMatches: string;
		readonly clearFilters: string;
		readonly pagination: ListPaginationLabels;
	};
	readonly onTabChange: (tab: ExpertCatalogTab) => void;
	readonly onCreate: () => void;
	readonly onUse: (id: string) => void;
	readonly onCopy: (id: string) => void;
	readonly onDetails: (id: string) => void;
	readonly onProject: (cwd: string) => void;
	readonly onNewProject: () => void;
	readonly preferences?: {
		readonly all: string;
		readonly favorites: string;
		readonly recent: string;
		readonly favorite: string;
		readonly unfavorite: string;
		readonly onToggleFavorite: (id: string) => void;
	};
}

/** Concrete catalog recipe: data and navigation belong to the host. */
export function ExpertCatalogView(props: ExpertCatalogViewProps): JSX.Element {
	const { tab, labels } = props;
	const [expertQuery, setExpertQuery] = useState("");
	const [projectQuery, setProjectQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState("");
	const [collection, setCollection] = useState<"all" | "favorites" | "recent">("all");
	const category = props.categories.some((item) => item.id === selectedCategory) ? selectedCategory : "";
	const expertPage = useListPagination(
		props.experts
			.filter(
				(expert) =>
					(collection !== "favorites" || expert.favorite) &&
					(collection !== "recent" || expert.recentIndex !== undefined) &&
					(!category || expert.category === category) &&
					`${expert.name} ${expert.description} ${expert.categoryLabel} ${expert.workflow.join(" ")}`
						.toLocaleLowerCase()
						.includes(expertQuery.trim().toLocaleLowerCase()),
			)
			.sort((a, b) => (collection === "recent" ? (a.recentIndex ?? Infinity) - (b.recentIndex ?? Infinity) : 0)),
		12,
		JSON.stringify([expertQuery, category, collection]),
	);
	const projectPage = useListPagination(
		props.projects.filter((project) =>
			`${project.name} ${project.cwd}`.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()),
		),
		12,
		projectQuery,
	);
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5 @md:p-8">
			<header className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold text-foreground">{props.title}</h1>
					<p className="mt-2 text-sm text-muted-foreground">{props.subtitle}</p>
				</div>
				{tab === "experts" && (
					<Button variant="outline" onClick={props.onCreate}>
						{labels.create}
					</Button>
				)}
			</header>
			<nav aria-label={props.title} className="mb-6 flex flex-wrap gap-1 border-b border-border pb-2">
				{props.tabs.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-current={tab === item.id ? "page" : undefined}
						onClick={() => props.onTabChange(item.id)}
						className={`rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring ${tab === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
					>
						{item.label}
					</button>
				))}
			</nav>
			{tab === "experts" && (
				<section className="flex min-w-0 flex-col gap-4">
					{props.sourceStatus && (
						<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
							<div className="min-w-0 flex-1 text-xs text-muted-foreground" role="status" aria-live="polite">
								<p className="font-medium text-foreground">{props.sourceStatus.name}</p>
								<p>{props.sourceStatus.message}</p>
								{props.sourceStatus.updatedAt && <p>{props.sourceStatus.updatedAt}</p>}
							</div>
							{props.onRefreshSource && (
								<Button
									variant="ghost"
									size="sm"
									disabled={props.sourceStatus.refreshing}
									onClick={props.onRefreshSource}
								>
									{props.sourceStatus.refreshLabel}
								</Button>
							)}
						</div>
					)}
					<div className="flex flex-wrap items-end gap-3">
						<label className="flex min-w-0 flex-1 basis-60 flex-col gap-1 text-[12px] text-muted-foreground">
							<span>{labels.expertSearch}</span>
							<input
								type="search"
								value={expertQuery}
								onChange={(event) => setExpertQuery(event.target.value)}
								className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
							/>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted-foreground">
							<span>{labels.category}</span>
							<select
								value={category}
								onChange={(event) => setSelectedCategory(event.target.value)}
								className="h-9 max-w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<option value="">{labels.allCategories}</option>
								{props.categories.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</label>
					</div>
					{props.preferences && (
						<div className="flex flex-wrap gap-2" role="group" aria-label={labels.expertSearch}>
							{(["all", "favorites", "recent"] as const).map((id) => (
								<Button
									key={id}
									variant={collection === id ? "secondary" : "ghost"}
									size="sm"
									aria-pressed={collection === id}
									onClick={() => setCollection(id)}
								>
									{props.preferences?.[id]}
								</Button>
							))}
						</div>
					)}
					<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
						{expertPage.total === 0 && (
							<div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
								<p>{props.experts.length === 0 ? labels.expertsEmpty : labels.noMatches}</p>
								{(expertQuery || category || collection !== "all") && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setExpertQuery("");
											setSelectedCategory("");
											setCollection("all");
										}}
									>
										{labels.clearFilters}
									</Button>
								)}
							</div>
						)}
						{expertPage.items.map((expert) => (
							<article
								key={expert.id}
								className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"
							>
								<div className="flex items-center gap-3">
									{expert.avatar && <img src={expert.avatar} alt="" className="h-10 w-10 rounded-xl object-cover" />}
									<h2 className="min-w-0 flex-1 truncate font-medium text-foreground">{expert.name}</h2>
									<span className="text-xs text-muted-foreground">{expert.sourceLabel}</span>
									{props.preferences && (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-pressed={Boolean(expert.favorite)}
											aria-label={`${expert.favorite ? props.preferences.unfavorite : props.preferences.favorite} · ${expert.name}`}
											onClick={() => props.preferences?.onToggleFavorite(expert.id)}
										>
											<span
												aria-hidden="true"
												className={`icon-[solar--star-linear] h-4 w-4 ${expert.favorite ? "text-primary" : "text-muted-foreground"}`}
											/>
										</Button>
									)}
								</div>
								<p className="text-[11px] text-muted-foreground">{expert.categoryLabel}</p>
								<p className="line-clamp-2 text-sm text-muted-foreground">{expert.description}</p>
								<p className="truncate text-xs text-muted-foreground" title={expert.workflow.join(" → ")}>
									{expert.workflow.join(" → ")}
								</p>
								<p className="mt-auto text-xs text-muted-foreground">{expert.abilityLabel}</p>
								{expert.unavailableReason && (
									<p className="text-xs text-muted-foreground">{expert.unavailableReason}</p>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => props.onDetails(expert.id)}
										aria-label={`${labels.details} · ${expert.name}`}
									>
										{labels.details}
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={Boolean(expert.unavailableReason)}
										onClick={() => props.onCopy(expert.id)}
										aria-label={`${labels.copy} · ${expert.name}`}
									>
										{labels.copy}
									</Button>
									<Button
										variant="primary"
										size="sm"
										className="ml-auto"
										disabled={Boolean(expert.unavailableReason)}
										onClick={() => props.onUse(expert.id)}
										aria-label={`${labels.use} · ${expert.name}`}
									>
										{labels.use}
									</Button>
								</div>
							</article>
						))}
					</div>
					<ListPagination {...expertPage} labels={labels.pagination} />
				</section>
			)}
			{tab === "collaboration" && (
				<section className="flex flex-col gap-4">
					<p className="text-sm leading-relaxed text-muted-foreground">{labels.collaborationHint}</p>
					<label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
						<span>{labels.projectSearch}</span>
						<input
							type="search"
							value={projectQuery}
							onChange={(event) => setProjectQuery(event.target.value)}
							className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</label>
					{props.projects.length === 0 ? (
						<div className="flex flex-col items-start gap-3">
							<p className="text-sm text-muted-foreground">{labels.projectsEmpty}</p>
							<Button variant="outline" onClick={props.onNewProject}>
								{labels.newProject}
							</Button>
						</div>
					) : (
						projectPage.items.map((project) => (
							<article
								key={project.cwd}
								className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border p-4"
							>
								<div className="min-w-0 flex-1">
									<h2 className="truncate font-medium text-foreground">{project.name}</h2>
									<p className="truncate text-xs text-muted-foreground">{project.cwd}</p>
									<p className="mt-1 text-xs text-muted-foreground">{project.sessionLabel}</p>
								</div>
								<Button variant="outline" onClick={() => props.onProject(project.cwd)}>
									{labels.openProject}
								</Button>
							</article>
						))
					)}
					{props.projects.length > 0 && projectPage.total === 0 && (
						<div className="flex flex-col items-start gap-2">
							<p className="text-sm text-muted-foreground">{labels.noMatches}</p>
							<Button variant="ghost" size="sm" onClick={() => setProjectQuery("")}>
								{labels.clearFilters}
							</Button>
						</div>
					)}
					<ListPagination {...projectPage} labels={labels.pagination} />
				</section>
			)}
		</div>
	);
}

export function ExpertWorkflowView({
	steps,
	title,
	emptyLabel,
}: {
	readonly steps: readonly string[];
	readonly title: string;
	readonly emptyLabel: string;
}): JSX.Element {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-sm font-medium text-foreground">{title}</h2>
			{steps.length ? (
				<ol className="flex flex-col gap-2">
					{steps.map((step, index) => (
						<li
							key={`${index}:${step}`}
							className="flex gap-3 rounded-xl border border-border bg-card/40 p-3 text-sm text-muted-foreground"
						>
							<span className="font-medium tabular-nums text-foreground">{index + 1}.</span>
							<span>{step}</span>
						</li>
					))}
				</ol>
			) : (
				<p className="text-sm text-muted-foreground">{emptyLabel}</p>
			)}
		</section>
	);
}
