import { appendNewSessionTaskBrief, activeInputDraftKeyAtom } from "@shared/store/atoms";
import { ExpertTaskPreparationView } from "@vetta-org/theme-ui/shared";
import { useAtomValue } from "jotai";
import type { AgentBlueprint } from "@567agent/agent-team";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTeamDirectoryDocument } from "./agent-team-directory";
import { parseAgentTargetKey } from "./target";
import type { NewSessionTargetKey } from "./target";

const FIELD_IDS = ["goal", "materials", "constraints", "deliverable"] as const;
type FieldId = (typeof FIELD_IDS)[number];

export function ExpertTaskPreparation({ targetKey }: { targetKey: NewSessionTargetKey | null }): JSX.Element | null {
	const document = useAgentTeamDirectoryDocument();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	useEffect(() => {
		let disposed = false;
		void window.agent567.agentTeams.listBlueprints().then(
			(items) => {
				if (!disposed) setBlueprints(items);
			},
			() => {},
		);
		return () => {
			disposed = true;
		};
	}, [document]);
	const id = parseAgentTargetKey(targetKey);
	const agent = document?.agents.find((item) => item.id === id);
	const draftKey = useAtomValue(activeInputDraftKeyAtom);
	if (!agent || !draftKey?.startsWith("new:")) return null;
	const prompt = agent.systemPrompt ?? blueprints.find((item) => item.id === agent.blueprintId)?.systemPrompt ?? "";
	return <TaskBrief key={`${draftKey}:${agent.id}`} draftKey={draftKey} prompt={prompt} />;
}

function TaskBrief({ draftKey, prompt }: { draftKey: string; prompt: string }): JSX.Element {
	const { t, i18n } = useTranslation("agent-teams");
	const [values, setValues] = useState<Record<FieldId, string>>({
		goal: "",
		materials: "",
		constraints: "",
		deliverable: "",
	});
	const [status, setStatus] = useState("");
	const hints = (prompt.split(/^## Inputs[ \t]*\r?\n/m)[1]?.split(/^## /m)[0] ?? "")
		.split(/\r?\n/)
		.map((line) => line.replace(/^[-*]\s+/, "").trim())
		.filter(Boolean)
		.slice(0, 8)
		.map((line) => {
			const [en, zh] = line.split(" | ");
			return (i18n.language.startsWith("zh") ? (zh ?? en) : en).slice(0, 500);
		});
	const fields = FIELD_IDS.map((id) => ({
		id,
		value: values[id],
		label: t(`experts.prepare.${id}`),
		placeholder: t(`experts.prepare.${id}Hint`),
		required: id === "goal",
	}));
	const preview = fields
		.filter((field) => field.value.trim())
		.map((field) => `## ${field.label}\n${field.value.trim()}`)
		.join("\n\n");
	return (
		<ExpertTaskPreparationView
			title={t("experts.prepare.title")}
			description={t("experts.prepare.hint")}
			hints={hints}
			fields={fields}
			preview={preview}
			previewLabel={t("experts.prepare.preview")}
			applyLabel={t("experts.prepare.apply")}
			status={status}
			disabled={!values.goal.trim()}
			onChange={(id, value) => {
				if (!FIELD_IDS.includes(id as FieldId)) return;
				setValues((current) => ({ ...current, [id]: value }));
				setStatus("");
			}}
			onApply={() => {
				if (!appendNewSessionTaskBrief(draftKey, preview)) {
					setStatus(t("experts.prepare.unavailable"));
					return;
				}
				setValues({ goal: "", materials: "", constraints: "", deliverable: "" });
				setStatus(t("experts.prepare.added"));
			}}
		/>
	);
}
