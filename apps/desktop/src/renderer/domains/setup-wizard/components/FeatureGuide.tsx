import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@shared/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const groups = [
	{ id: "start", topics: ["files", "context"] },
	{ id: "create", topics: ["images", "canvas"] },
	{ id: "collaborate", topics: ["remote", "collaboration"] },
] as const;
type Topic = "task" | (typeof groups)[number]["topics"][number];

export function FeatureGuideContent(): JSX.Element {
	const { t } = useTranslation("common");
	const [topic, setTopic] = useState<Topic | null>(null);
	const [query, setQuery] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const matches = (item: Topic) =>
		(["title", "where", "one", "two", "three"] as const)
			.map((field) => t(`featureGuide.topics.${item}.${field}`))
			.join(" ")
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase());
	const visibleGroups = groups
		.map((group) => ({ ...group, topics: group.topics.filter(matches) }))
		.filter((group) => group.topics.length > 0);
	const taskVisible = matches("task");
	const heading = useRef<HTMLHeadingElement>(null);
	const buttons = useRef<Partial<Record<Topic, HTMLButtonElement | null>>>({});
	const previousTopic = useRef<Topic | null>(null);

	useEffect(() => {
		if (topic) heading.current?.focus();
		else if (previousTopic.current) buttons.current[previousTopic.current]?.focus();
		previousTopic.current = topic;
	}, [topic]);

	if (topic) {
		return (
			<article className="min-w-0 space-y-5 text-left [overflow-wrap:anywhere]">
				<Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setTopic(null)}>
					<span aria-hidden="true" className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
					{t("featureGuide.back")}
				</Button>
				<h3 ref={heading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
					{t(`featureGuide.topics.${topic}.title`)}
				</h3>
				<div className="rounded-lg bg-muted/50 p-4">
					<p className="text-[11px] font-medium text-muted-foreground">{t("featureGuide.location")}</p>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
						{t(`featureGuide.topics.${topic}.where`)}
					</p>
				</div>
				<ol className="list-decimal space-y-5 pl-5 text-[13px] leading-relaxed marker:font-mono marker:text-muted-foreground">
					{(["one", "two", "three"] as const).map((step) => (
						<li key={step} className="pl-1">
							{t(`featureGuide.topics.${topic}.${step}`)}
						</li>
					))}
				</ol>
			</article>
		);
	}

	return (
		<div className="@container min-w-0 space-y-5 text-left">
			<p className="text-[12px] leading-relaxed text-muted-foreground">{t("featureGuide.intro")}</p>
			<div className="relative">
				<span
					aria-hidden="true"
					className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					ref={searchInput}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					aria-label={t("featureGuide.search")}
					placeholder={t("featureGuide.search")}
					className="pl-9 pr-9"
				/>
				{query && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="absolute right-1 top-1/2 -translate-y-1/2"
						aria-label={t("featureGuide.clear")}
						onClick={() => {
							setQuery("");
							searchInput.current?.focus();
						}}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			{!taskVisible && visibleGroups.length === 0 && (
				<p role="status" className="py-6 text-[12px] text-muted-foreground">
					{t("featureGuide.noResults")}
				</p>
			)}
			{taskVisible && (
				<Button
					ref={(node) => {
						buttons.current.task = node;
					}}
					variant="outline"
					className="h-auto w-full justify-between gap-3 whitespace-normal rounded-xl bg-muted/30 px-4 py-4 text-left"
					aria-label={t("featureGuide.topics.task.title")}
					onClick={() => setTopic("task")}
				>
					<span className="min-w-0">
						<span className="block text-[13px] font-medium">{t("featureGuide.topics.task.title")}</span>
						<span className="mt-1 block text-[12px] font-normal text-muted-foreground">
							{t("featureGuide.firstTaskHint")}
						</span>
					</span>
					<span aria-hidden="true" className="icon-[solar--arrow-right-linear] h-4 w-4 shrink-0" />
				</Button>
			)}
			<div className="grid gap-4 @min-[32rem]:grid-cols-3">
				{visibleGroups.map((group) => (
					<section key={group.id} className="min-w-0 border-t border-border/60 pt-4">
						<h3 className="mb-1.5 text-[11px] font-medium text-muted-foreground">
							{t(`featureGuide.groups.${group.id}`)}
						</h3>
						{group.topics.map((item) => (
							<Button
								key={item}
								ref={(node) => {
									buttons.current[item] = node;
								}}
								variant="ghost"
								size="sm"
								className="h-auto w-full justify-between gap-2 whitespace-normal px-2 py-2.5 text-left text-[13px]"
								onClick={() => setTopic(item)}
							>
								{t(`featureGuide.topics.${item}.title`)}
								<span
									aria-hidden="true"
									className="icon-[solar--alt-arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground"
								/>
							</Button>
						))}
					</section>
				))}
			</div>
		</div>
	);
}

export function FeatureGuide(): JSX.Element {
	const { t } = useTranslation("common");
	const content = useRef<HTMLDivElement>(null);
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					{t("featureGuide.open")}
				</Button>
			</DialogTrigger>
			<DialogContent
				ref={content}
				showCloseButton={false}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.querySelector<HTMLButtonElement>("[data-guide-body] button")?.focus();
				}}
				className="h-[min(80dvh,38rem)] min-w-0 max-w-[min(40rem,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
			>
				<DialogHeader className="border-b border-border/60 pb-4 pr-8">
					<DialogTitle>{t("featureGuide.title")}</DialogTitle>
					<DialogDescription>{t("featureGuide.description")}</DialogDescription>
				</DialogHeader>
				<div
					data-guide-body
					className="min-h-0 min-w-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
				>
					<FeatureGuideContent />
				</div>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute right-2 top-2"
						aria-label={t("actions.close")}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-4 w-4" />
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
