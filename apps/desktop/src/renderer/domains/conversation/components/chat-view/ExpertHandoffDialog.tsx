import { useAgentTeamResources } from "@domains/agent-teams/hooks/useAgentTeamResources";
import {
	activeSessionAtom,
	chatMessagesAtom,
	appendExpertHandoffDraft,
	expertPreferencesAtom,
} from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { ExpertHandoffView } from "@vetta-org/theme-ui/shared";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const FIELDS = ["outcome", "todo", "constraints"] as const;
export function ExpertHandoffDialog({ onClose }: { onClose: () => void }): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const resources = useAgentTeamResources();
	const current = useAtomValue(activeSessionAtom);
	const messages = useAtomValue(chatMessagesAtom);
	const [origin] = useState(current);
	const [expertId, setExpertId] = useState("");
	const [values, setValues] = useState({ outcome: "", todo: "", constraints: "" });
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [status, setStatus] = useState<string>();
	const updatePreferences = useSetAtom(expertPreferencesAtom);
	const navigate = useNavigate();
	const latest = [...messages].reverse().find((item) => item.kind === "agent" && item.phase === "completed");
	const text =
		latest?.kind === "agent"
			? latest.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n")
			: "";
	const experts =
		resources.document?.agents
			.filter((agent) => agent.scope.kind === "library")
			.map((agent) => ({
				id: agent.id,
				name: agent.name,
				disabled: Boolean(
					agent.source && !resources.blueprints.some((blueprint) => blueprint.id === agent.blueprintId),
				),
			})) ?? [];
	const fields = FIELDS.map((id) => ({ id, label: t(`experts.handoff.${id}`), value: values[id] }));
	const preview = [
		t("experts.handoff.prefix"),
		`${t("experts.handoff.expert")}: ${experts.find((item) => item.id === expertId)?.name ?? ""}`,
		...fields.filter((field) => field.value.trim()).map((field) => `## ${field.label}\n${field.value.trim()}`),
	].join("\n\n");
	const valid = Boolean(
		origin?.cwd &&
			(saved || current?.sessionPath === origin.sessionPath) &&
			experts.some((item) => item.id === expertId && !item.disabled),
	);
	const apply = async () => {
		if (!valid || busy || !origin?.cwd || !values.todo.trim()) return;
		setBusy(true);
		let appended = saved;
		try {
			if (!saved) {
				appendExpertHandoffDraft(origin.cwd, preview);
				appended = true;
				setSaved(true);
			}
			updatePreferences({ kind: "use", id: expertId });
			await navigate({
				to: "/new-session",
				search: { target: `agent:${expertId}`, cwd: encodeURIComponent(origin.cwd) },
			});
			onClose();
		} catch {
			setStatus(t(appended ? "experts.handoff.saved" : "experts.handoff.error"));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ExpertHandoffView
			title={t("experts.handoff.title")}
			description={t("experts.handoff.hint")}
			expertLabel={t("experts.handoff.expert")}
			expertId={expertId}
			experts={experts}
			onExpert={setExpertId}
			fields={fields}
			onField={(id, value) => {
				if (FIELDS.includes(id as (typeof FIELDS)[number])) setValues((old) => ({ ...old, [id]: value }));
			}}
			preview={preview}
			labels={{
				choose: t("experts.handoff.choose"),
				latest: t("experts.handoff.latest"),
				preview: t("experts.prepare.preview"),
				apply: t(saved ? "experts.handoff.openSaved" : "experts.handoff.apply"),
				cancel: t("experts.handoff.cancel"),
			}}
			onLatest={() => {
				if (text.length + values.outcome.length + 2 > 8000) {
					setStatus(t("experts.handoff.tooLong"));
					return;
				}
				setValues((old) => ({ ...old, outcome: [old.outcome, text].filter(Boolean).join("\n\n") }));
			}}
			editingDisabled={saved || busy}
			latestDisabled={saved || busy || !text || !origin || current?.sessionPath !== origin.sessionPath}
			onApply={() => void apply()}
			onClose={onClose}
			disabled={!valid || !values.todo.trim() || busy || resources.loading}
			status={status ?? (resources.error ? t("experts.handoff.error") : undefined)}
		/>
	);
}
