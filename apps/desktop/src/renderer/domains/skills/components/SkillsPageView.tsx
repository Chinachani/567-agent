import { WorkspacePageHeader } from "@vetta-org/theme-ui/shared";
import { SkillTagGroupView } from "@vetta-org/theme-ui/skills";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { UNCATEGORIZED, type SkillsPageModel } from "../hooks/useSkillsPageModel";
import { SkillTagGroup } from "./SkillTagGroup";

const easeOut = [0.22, 1, 0.36, 1] as const;

/** 场景页；skill / mcp / plugin / bundle 已并入能力页（ADR-0049）。 */
export function SkillsPageView({ model }: { model: SkillsPageModel }): JSX.Element {
	const { t } = useTranslation("skills");
	const {
		searchQuery,
		setSearchQuery,
		loading,
		error,
		actionStates,
		fileInputRef,
		groups,
		agentForTab,
		hasContent,
		handleInstall,
		handleToggle,
		handleUninstall,
		handlePreview,
		handleFileChange,
	} = model;
	const typeNoun = t("typeNoun.scene");

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<input
				ref={fileInputRef}
				type="file"
				accept=".zip,.tar.gz,.tgz,application/zip,application/gzip,application/x-gzip"
				className="hidden"
				onChange={handleFileChange}
			/>
			<div className="shrink-0 px-5 pt-6 sm:px-8">
				<WorkspacePageHeader
					title={t("tabs.scene")}
					description={t("subtitle")}
					className="mx-auto w-full max-w-6xl border-b border-border/60 pb-6"
				/>
				<div className="relative mx-auto my-5 w-full max-w-6xl">
					<span className="icon-[solar--magnifer-linear] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
					<input
						type="search"
						aria-label={t("search.placeholder", { noun: typeNoun })}
						placeholder={t("search.placeholder", { noun: typeNoun })}
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-5 pt-5 pb-8 sm:px-8 [scrollbar-gutter:stable]">
				<div className="mx-auto w-full max-w-6xl">
					{loading ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 opacity-60">
							<motion.span
								className="icon-[solar--refresh-linear] h-8 w-8 text-primary/60"
								animate={{ rotate: 360 }}
								transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
							/>
							<p className="text-[13px] text-muted-foreground">{t("loading")}</p>
						</div>
					) : error && !hasContent ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 opacity-60">
							<span className="icon-[solar--danger-circle-linear] h-10 w-10 text-muted-foreground" />
							<p className="text-[13px] text-muted-foreground">{error}</p>
						</div>
					) : !hasContent ? (
						<motion.div
							className="flex h-full flex-col items-center justify-center gap-5 text-center"
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, ease: easeOut }}
						>
							<motion.div className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
								<span className="relative icon-[solar--clapperboard-open-linear] h-7 w-7" />
							</motion.div>
							<div className="space-y-1.5">
								<p className="text-[15px] font-semibold text-foreground">
									{searchQuery ? t("empty.noMatch") : t("empty.none", { noun: typeNoun })}
								</p>
								<p className="text-[12px] text-muted-foreground">
									{searchQuery ? t("empty.noMatchHint") : t("empty.noneHint")}
								</p>
							</div>
						</motion.div>
					) : (
						<motion.div
							className="flex flex-col gap-7"
							initial="hidden"
							animate="show"
							variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
						>
							{error && (
								<div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground/70">
									<span className="icon-[solar--danger-circle-linear] h-4 w-4 shrink-0 text-muted-foreground" />
									<span>{t("error.partialFallback", { error, noun: typeNoun })}</span>
								</div>
							)}
							{agentForTab.length > 0 && (
								<SkillTagGroup
									tag={t("group.agentSkill")}
									skills={agentForTab}
									onInstall={handleInstall}
									onToggle={handleToggle}
									onUninstall={handleUninstall}
									onPreview={handlePreview}
									actionStates={actionStates}
								/>
							)}
							{Array.from(groups.entries()).map(([tag, skills]) => (
								<SkillTagGroup
									key={tag}
									tag={tag === UNCATEGORIZED ? t("group.uncategorized") : tag}
									skills={skills}
									onInstall={handleInstall}
									onToggle={handleToggle}
									onUninstall={handleUninstall}
									onPreview={handlePreview}
									actionStates={actionStates}
								/>
							))}
						</motion.div>
					)}
				</div>
			</div>
		</div>
	);
}

export type ThemeUiLink_SkillTagGroupView = typeof SkillTagGroupView;
