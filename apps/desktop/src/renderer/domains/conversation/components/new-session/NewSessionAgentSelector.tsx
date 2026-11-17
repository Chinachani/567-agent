import { useAgentAvatarResolver } from "@shared/agent-teams/agent-avatar";
import { useLocalizedAgentTeamDocument } from "@shared/agent-teams/agent-team-localization";
import { type AgentTeamDocument, listLibraryAgentProfiles } from "@567agent/agent-team";
import { NewSessionPicker, type NewSessionPickerRootProps } from "@vetta-org/theme-ui/chat";
import { AvatarStackView } from "@vetta-org/theme-ui/shared";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cachedAgentTeamDocument, loadAgentTeamDocument, subscribeAgentTeamDocument } from "./agent-team-directory";
import { agentTargetKey, filterTargetOptions, type NewSessionTargetKey, type NewSessionTargetOption } from "./target";

export interface NewSessionAgentSelectorProps {
	readonly selectedKey: NewSessionTargetKey | null;
	readonly onSelect: (targetKey: NewSessionTargetKey | null) => void;
	readonly className?: string;
	readonly picker?: {
		readonly open: boolean;
		readonly onOpenChange: (open: boolean) => void;
	};
}

const SEARCH_THRESHOLD = 5;

/** 专家选择器只列库中档案；旧团队仅保留历史入口。 */
export function NewSessionAgentSelector({
	selectedKey,
	onSelect,
	className,
	picker,
}: NewSessionAgentSelectorProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [loadedDocument, setDocument] = useState<AgentTeamDocument | undefined>(cachedAgentTeamDocument);
	const document = useLocalizedAgentTeamDocument(loadedDocument);
	const [localOpen, setOpen] = useState(false);
	const open = picker?.open ?? localOpen;
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setDocument(await loadAgentTeamDocument());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		const unsubscribe = subscribeAgentTeamDocument(() => setDocument(cachedAgentTeamDocument()));
		void load();
		return unsubscribe;
	}, [load]);
	const resolveAvatar = useAgentAvatarResolver();
	// 只列智能体库里的 Agent：团队 `copy` 绑定产生的 team scope 副本是团队私有的，
	// 摆进来会变成一堆同名影子条目。
	const agentOptions = useMemo<readonly NewSessionTargetOption[]>(
		() =>
			(document ? listLibraryAgentProfiles(document) : []).map((agent) => ({
				targetKey: agentTargetKey(agent.id),
				title: agent.name,
				...(agent.description ? { subtitle: agent.description } : {}),
				avatarUrls: [resolveAvatar(agent)],
				selected: selectedKey === agentTargetKey(agent.id),
			})),
		[document, resolveAvatar, selectedKey],
	);
	const visibleAgents = useMemo(() => filterTargetOptions(agentOptions, query), [agentOptions, query]);
	const selectedOption = agentOptions.find((option) => option.targetKey === selectedKey);
	const searchVisible = agentOptions.length > SEARCH_THRESHOLD;
	const nothingVisible = visibleAgents.length === 0;

	const handleOpenChange: NonNullable<NewSessionPickerRootProps["onOpenChange"]> = useCallback(
		(next) => {
			if (picker) picker.onOpenChange(next);
			else setOpen(next);
			if (!next) setQuery("");
		},
		[picker],
	);
	const handleSelect = useCallback(
		(next: string | null) => {
			onSelect(next as NewSessionTargetKey | null);
			handleOpenChange(false);
		},
		[handleOpenChange, onSelect],
	);

	const triggerLabel = selectedOption
		? t("newSession.agentSelector.switchTitle")
		: t("newSession.agentSelector.pickTitle");

	const renderOption = (option: NewSessionTargetOption): JSX.Element => (
		<NewSessionPicker.Item key={option.targetKey} value={option.targetKey}>
			{option.avatarUrls?.length ? (
				<AvatarStackView avatarUrls={option.avatarUrls} />
			) : (
				<NewSessionPicker.ItemIcon>
					<span className="icon-[solar--users-group-rounded-linear]" />
				</NewSessionPicker.ItemIcon>
			)}
			<NewSessionPicker.ItemText>
				<span className="flex min-w-0 flex-col">
					<span className="truncate">{option.title}</span>
					{option.subtitle && (
						<span className="truncate text-[11px] font-normal text-muted-foreground/70">{option.subtitle}</span>
					)}
				</span>
			</NewSessionPicker.ItemText>
			{option.selected && <NewSessionPicker.ItemIndicator />}
		</NewSessionPicker.Item>
	);

	return (
		<NewSessionPicker.Root
			open={open}
			onOpenChange={handleOpenChange}
			value={selectedKey}
			onValueChange={handleSelect}
		>
			<NewSessionPicker.Trigger
				className={className}
				aria-label={triggerLabel}
				title={selectedOption?.title ?? triggerLabel}
			>
				{selectedOption?.avatarUrls?.length ? (
					<AvatarStackView avatarUrls={selectedOption.avatarUrls} />
				) : (
					<span
						className="icon-[solar--user-speak-rounded-linear] h-4 w-4 shrink-0 text-muted-foreground"
						aria-hidden
					/>
				)}
				<span className="min-w-0 truncate">{selectedOption?.title ?? t("newSession.agentSelector.pick")}</span>
				<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 opacity-70" aria-hidden />
			</NewSessionPicker.Trigger>
			<NewSessionPicker.Content>
				{searchVisible && (
					<NewSessionPicker.Search
						value={query}
						onValueChange={setQuery}
						placeholder={t("newSession.agentSelector.searchPlaceholder")}
					/>
				)}
				<NewSessionPicker.Viewport>
					{selectedKey && <NewSessionPicker.Clear>{t("newSession.agentSelector.clear")}</NewSessionPicker.Clear>}
					{loading ? (
						<NewSessionPicker.Loading>{t("newSession.agentSelector.loading")}</NewSessionPicker.Loading>
					) : error ? (
						<>
							<NewSessionPicker.Error>{t("newSession.agentSelector.error")}</NewSessionPicker.Error>
							<Button
								variant="ghost"
								className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-foreground hover:bg-accent"
								onClick={() => void load()}
							>
								{t("newSession.agentSelector.retry")}
							</Button>
						</>
					) : nothingVisible ? (
						<NewSessionPicker.Group>
							<NewSessionPicker.Empty>{t("newSession.agentSelector.empty")}</NewSessionPicker.Empty>
						</NewSessionPicker.Group>
					) : (
						<>
							{visibleAgents.length > 0 && (
								<NewSessionPicker.Group label={t("newSession.agentSelector.groupAgents")}>
									{visibleAgents.map(renderOption)}
								</NewSessionPicker.Group>
							)}
						</>
					)}
				</NewSessionPicker.Viewport>
			</NewSessionPicker.Content>
		</NewSessionPicker.Root>
	);
}
