import { groupEntriesForSelection } from "@/shared/api567/group-display";
import { useApi567 } from "@domains/api567/hooks/useApi567";
import { Button } from "@vetta-org/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const GROUP_FORM_ID = "setup-wizard-group-choice";

type Props = { onNext: () => void; onBusy: (busy: boolean) => void };

export function GroupSelectionStep(props: Props) {
	const api = useApi567();
	return (
		<GroupForm
			key={JSON.stringify([
				api.status.isLoggedIn,
				api.status.authType,
				api.status.loginUsername ?? api.status.username,
			])}
			api={api}
			{...props}
		/>
	);
}

function GroupForm({ api, onBusy, onNext }: Props & { api: ReturnType<typeof useApi567> }) {
	const { t } = useTranslation("common");
	const { status, groupsLoadState, availableGroups } = api;
	const [draft, setDraft] = useState<{ chat?: string | null; image?: string | null }>({});
	const [feedback, setFeedback] = useState("");
	const [busy, setBusy] = useState(false);
	const saving = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (saving.current) onBusy(false);
		};
	}, [onBusy]);
	const entries = groupEntriesForSelection(availableGroups);
	const choose = (type: "chat" | "image", current: string | undefined) => {
		const value = draft[type] !== undefined ? (draft[type] ?? "") : (current ?? "");
		return (
			<label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
				{t(`setupWizard.groups.${type}`)}
				<select
					value={value}
					disabled={busy || !status.isLoggedIn || !entries.length}
					className="min-h-10 w-full rounded-lg border border-input bg-card px-2 text-card-foreground focus-visible:outline-ring disabled:opacity-60"
					onChange={(event) => {
						setDraft({ ...draft, [type]: event.target.value || null });
						setFeedback("");
					}}
				>
					<option value="">{t("setupWizard.groups.later")}</option>
					{value && !entries.some(([name]) => name === value) && (
						<option disabled value={value}>
							{value}
						</option>
					)}
					{entries.map(([name, info]) => (
						<option key={name} value={name}>
							{name} · {info.ratio}×
						</option>
					))}
				</select>
			</label>
		);
	};
	const save = async () => {
		if (saving.current) return;
		saving.current = true;
		setBusy(true);
		onBusy(true);
		setFeedback("");
		let field: "chat" | "image" = "chat";
		try {
			for (const type of ["chat", "image"] as const) {
				field = type;
				const name = draft[type];
				if (!name || name === (type === "chat" ? status.activeGroup : status.imageGroup)) continue;
				if (!status.isLoggedIn || !entries.some(([key]) => key === name))
					throw new Error(t("setupWizard.groups.unavailable"));
				const result = type === "chat" ? await api.setActiveGroup(name) : await api.setImageGroup(name);
				if (!mounted.current) return;
				if (!result.success) throw new Error(result.message || t("setupWizard.groups.retry"));
				setDraft((previous) => ({ ...previous, [type]: undefined }));
			}
			onNext();
		} catch (error) {
			if (mounted.current)
				setFeedback(
					t("setupWizard.groups.saveError", {
						field: t(`setupWizard.groups.${field}`),
						message: error instanceof Error ? error.message : String(error),
					}),
				);
		} finally {
			if (mounted.current) {
				saving.current = false;
				setBusy(false);
				onBusy(false);
			}
		}
	};
	return (
		<form
			id={GROUP_FORM_ID}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<header>
				<h2 className="text-2xl font-semibold">{t("setupWizard.groups.title")}</h2>
				<p className="mt-2 text-sm text-muted-foreground">{t("setupWizard.groups.description")}</p>
			</header>
			<div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
				{choose("chat", status.activeGroup)}
				{choose("image", status.imageGroup)}
			</div>
			{(!api.initialCheckDone ||
				groupsLoadState.loading ||
				!status.isLoggedIn ||
				groupsLoadState.error ||
				!entries.length) && (
				<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					<span role="status">
						{t(
							!api.initialCheckDone || groupsLoadState.loading
								? "setupWizard.groups.loading"
								: !status.isLoggedIn
									? "setupWizard.groups.signIn"
									: groupsLoadState.error
										? entries.length
											? "setupWizard.groups.cache"
											: "setupWizard.groups.unavailable"
										: "setupWizard.groups.empty",
						)}
					</span>
					{status.isLoggedIn && !groupsLoadState.loading && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void api.loadAvailableGroups(true)}
						>
							{t("setupWizard.groups.retry")}
						</Button>
					)}
				</div>
			)}
			{feedback && (
				<p role="alert" className="text-sm text-destructive">
					{feedback}
				</p>
			)}
		</form>
	);
}
