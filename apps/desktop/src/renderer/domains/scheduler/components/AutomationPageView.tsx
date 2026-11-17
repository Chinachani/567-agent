import { AutomationPageView as ThemeAutomationPageView } from "@vetta-org/theme-ui/scheduler";
import { useTranslation } from "react-i18next";
import type { AutomationPageModel } from "../hooks/useAutomationPageModel";
import { AutomationDetailPane } from "./AutomationDetailPane";
import { TaskList } from "./TaskList";

export type AutomationPageViewProps = AutomationPageModel;

export function AutomationPageView({
	filters,
	activeFilter,
	search,
	hasTasks,
	error,
	recommendations,
	pane,
	selectedTaskId,
	onFilterChange,
	onSearchChange,
	onCreate,
	onSelectRecommendation,
	onSelectTask,
	onClosePane,
	onCreated,
}: AutomationPageViewProps): JSX.Element {
	const { t } = useTranslation("automation");

	return (
		<ThemeAutomationPageView
			labels={{
				title: t("page.title"),
				subtitle: t("page.subtitle"),
				create: t("page.create"),
				searchPlaceholder: t("page.searchPlaceholder"),
				recommendTitle: t("recommend.title"),
			}}
			filters={filters}
			activeFilter={activeFilter}
			onFilterChange={onFilterChange}
			searchValue={search}
			onSearchChange={onSearchChange}
			onCreate={onCreate}
			list={
				error ? (
					<p role="alert" className="p-3 text-sm text-[var(--danger)]">
						{error}
					</p>
				) : (
					<TaskList
						selectedTaskId={selectedTaskId}
						filter={activeFilter}
						search={search}
						onSelectTask={onSelectTask}
					/>
				)
			}
			recommendations={hasTasks || error ? undefined : recommendations}
			onSelectRecommendation={onSelectRecommendation}
			detailPane={
				pane.kind === "none" ? null : (
					<AutomationDetailPane
						key={pane.kind === "task" ? `task:${pane.task.id}` : `create:${pane.key}`}
						pane={pane}
						onClose={onClosePane}
						onCreated={onCreated}
					/>
				)
			}
		/>
	);
}
