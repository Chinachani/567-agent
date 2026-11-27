import type { SshHostFormInput, SshHostProbe, SshHostSummary, SshPrivateKeySelection } from "@preload/api-types/ssh";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SshHostFormState {
	label: string;
	/** 主机地址：IP、域名，或 ~/.ssh/config 里的别名。 */
	host: string;
	/** 用户名，可空（空则由 ssh config 或本机用户名决定）。 */
	username: string;
	port: string;
	identityFile: string;
	authMethod: "key" | "password";
	password: string;
}

/** 某一行的探测结果。成功与失败都留在行内，不打断用户去看别处。 */
export interface SshHostRowMessage {
	tone: "success" | "error";
	text: string;
	/** 原始 stderr。默认折叠——它对定位问题有用，但不该当作首行文案。 */
	details?: string;
}

export interface SshHostsSettingsLabels {
	title: string;
	description: string;
	loading: string;
	section: string;
	add: string;
	addTitle: string;
	editTitle: string;
	save: string;
	cancel: string;
	empty: string;
	emptyHint: string;
	importFromConfig: string;
	importNone: string;
	importDone: string;
	fieldLabel: string;
	fieldLabelHint: string;
	fieldHost: string;
	fieldHostHint: string;
	fieldUsername: string;
	fieldUsernameHint: string;
	passwordIgnoresConfigKey: string;
	fieldPort: string;
	fieldIdentityFile: string;
	fieldIdentityFileHint: string;
	pickPrivateKey: string;
	replacePrivateKey: string;
	discardPrivateKey: string;
	privateKeyPending: string;
	authKey: string;
	authPassword: string;
	fieldPassword: string;
	fieldPasswordHint: string;
	fieldPasswordSavedHint: string;
	test: string;
	testing: string;
	testDetails: string;
	edit: string;
	remove: string;
	removeTitle: string;
	removeConfirm: string;
	statusConnected: string;
	statusUnverifiable: string;
	statusUnknown: string;
}

export interface SshHostsSettingsModel {
	loading: boolean;
	hosts: readonly SshHostSummary[];
	/** 正在编辑的主机 id；`"new"` 表示新增表单展开中；null 表示表单关闭。 */
	editingId: string | "new" | null;
	form: SshHostFormState;
	saving: boolean;
	privateKeySelection: SshPrivateKeySelection | null;
	pickingPrivateKey: boolean;
	formError: string | null;
	/** 正在测试的主机 id。按行记录而不是全局布尔，多台主机可各自独立测试。 */
	testingId: string | null;
	rowMessage: Readonly<Record<string, SshHostRowMessage>>;
	importing: boolean;
	labels: SshHostsSettingsLabels;
	actions: {
		startAdd: () => void;
		startEdit: (host: SshHostSummary) => void;
		cancelEdit: () => void;
		setForm: (patch: Partial<SshHostFormState>) => void;
		pickPrivateKey: () => Promise<void>;
		discardPrivateKey: () => void;
		submit: () => Promise<void>;
		test: (host: SshHostSummary) => Promise<void>;
		remove: (host: SshHostSummary) => void;
		importFromConfig: () => Promise<void>;
	};
}

const EMPTY_FORM: SshHostFormState = {
	label: "",
	host: "",
	username: "",
	port: "",
	identityFile: "",
	authMethod: "key",
	password: "",
};

export function useSshHostsSettingsModel(): SshHostsSettingsModel {
	const { t } = useTranslation("settings");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [loading, setLoading] = useState(true);
	const [hosts, setHosts] = useState<readonly SshHostSummary[]>([]);
	const [editingId, setEditingId] = useState<string | "new" | null>(null);
	const [form, setFormState] = useState<SshHostFormState>(EMPTY_FORM);
	const [saving, setSaving] = useState(false);
	const [privateKeySelection, setPrivateKeySelection] = useState<SshPrivateKeySelection | null>(null);
	const [pickingPrivateKey, setPickingPrivateKey] = useState(false);
	const pickRequest = useRef<AbortController | null>(null);
	const stagedRef = useRef<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [rowMessage, setRowMessage] = useState<Record<string, SshHostRowMessage>>({});
	const [importing, setImporting] = useState(false);

	const refresh = useCallback(async () => {
		setHosts(await window.agent567.ssh.listHosts());
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
		// 主机状态由后台动作（工具调用、文件树刷新）改变，不经过本页面；没有这条订阅
		// 列表会一直停在打开设置页那一刻的状态上。
		const offHosts = window.agent567.ssh.onHostsChanged(() => void refresh());
		const offStatus = window.agent567.ssh.onHostStatusChanged(({ hostId, status }) => {
			setHosts((previous) => previous.map((host) => (host.id === hostId ? { ...host, status } : host)));
		});
		return () => {
			offHosts();
			offStatus();
		};
	}, [refresh]);

	useEffect(() => {
		return () => {
			pickRequest.current?.abort();
			if (stagedRef.current) discardSelection(stagedRef.current);
		};
	}, []);

	const discardPrivateKey = useCallback(() => {
		pickRequest.current?.abort();
		pickRequest.current = null;
		if (stagedRef.current) discardSelection(stagedRef.current);
		stagedRef.current = null;
		setPickingPrivateKey(false);
		setPrivateKeySelection(null);
		setFormError(null);
	}, []);

	const pickPrivateKey = useCallback(async () => {
		if (pickRequest.current || saving) return;
		const request = new AbortController();
		pickRequest.current = request;
		setPickingPrivateKey(true);
		setFormError(null);
		try {
			const selection = await window.agent567.ssh.pickPrivateKey();
			if (selection) {
				if (request.signal.aborted) discardSelection(selection.ref);
				else {
					stagedRef.current = selection.ref;
					setPrivateKeySelection(selection);
				}
			}
		} catch (error) {
			if (!request.signal.aborted) setFormError(toMessage(error));
		} finally {
			if (pickRequest.current === request) {
				pickRequest.current = null;
				setPickingPrivateKey(false);
			}
		}
	}, [saving]);

	const setForm = useCallback(
		(patch: Partial<SshHostFormState>) => {
			if (saving) return;
			if (patch.authMethod === "password" || patch.identityFile !== undefined) discardPrivateKey();
			setFormState((previous) => ({ ...previous, ...patch }));
			setFormError(null);
		},
		[discardPrivateKey, saving],
	);

	const startAdd = useCallback(() => {
		discardPrivateKey();
		setFormState(EMPTY_FORM);
		setEditingId("new");
	}, [discardPrivateKey]);

	const startEdit = useCallback(
		(host: SshHostSummary) => {
			discardPrivateKey();
			setFormState({
				label: host.label,
				...splitTarget(host.target),
				port: host.port === undefined ? "" : String(host.port),
				identityFile: host.identityFile ?? "",
				authMethod: host.authMethod ?? "key",
				password: "",
			});
			setEditingId(host.id);
		},
		[discardPrivateKey],
	);

	const cancelEdit = useCallback(() => {
		if (saving) return;
		discardPrivateKey();
		setFormState(EMPTY_FORM);
		setEditingId(null);
	}, [discardPrivateKey, saving]);

	const submit = useCallback(async () => {
		if (editingId === null || saving || pickRequest.current) return;
		const port = form.port.trim();
		const target = composeTarget(form.username, form.host);
		const input: SshHostFormInput = {
			label: form.label.trim() || target,
			target,
			...(port ? { port: Number(port) } : {}),
			...(form.authMethod === "password"
				? { authMethod: "password" as const, ...(form.password ? { password: form.password } : {}) }
				: privateKeySelection
					? { privateKeyRef: privateKeySelection.ref }
					: form.identityFile.trim()
						? { identityFile: form.identityFile.trim() }
						: {}),
		};
		setSaving(true);
		setFormError(null);
		try {
			if (editingId === "new") await window.agent567.ssh.createHost(input);
			else await window.agent567.ssh.updateHost({ ...input, id: editingId });
			discardPrivateKey();
			setFormState(EMPTY_FORM);
			setEditingId(null);
			await refresh();
		} catch (error) {
			// 表单保持打开且保留已输入内容：让用户在原地改，而不是重填一遍。
			setFormError(toMessage(error));
		} finally {
			setSaving(false);
		}
	}, [discardPrivateKey, editingId, form, privateKeySelection, refresh, saving]);

	const test = useCallback(
		async (host: SshHostSummary) => {
			setTestingId(host.id);
			setRowMessage((previous) => {
				const { [host.id]: _removed, ...rest } = previous;
				return rest;
			});
			try {
				const outcome = classifyProbe(await window.agent567.ssh.testHost(host.id));
				// 连上了就只说连上了。远端缺 rg / fd 不在这里提——测连接的时刻对此无从下手，
				// 而真正用到搜索工具时，远端执行层会点名是哪台主机缺了哪个命令
				// （packages/runtime-ssh/src/ssh-tool-process.ts）。
				const message: SshHostRowMessage =
					outcome.kind === "failed"
						? { tone: "error", text: t("sshTestFailed"), details: outcome.details }
						: { tone: "success", text: t("sshTestOk", { platform: outcome.platform }) };
				setRowMessage((previous) => ({ ...previous, [host.id]: message }));
			} catch (error) {
				setRowMessage((previous) => ({
					...previous,
					[host.id]: { tone: "error", text: t("sshTestFailed"), details: toMessage(error) },
				}));
			} finally {
				setTestingId(null);
			}
		},
		[t],
	);

	const remove = useCallback(
		(host: SshHostSummary) => {
			setConfirm({
				title: t("sshRemoveTitle"),
				message: t("sshRemoveConfirm", { name: host.label }),
				confirmLabel: t("sshRemove"),
				variant: "danger",
				onConfirm: () => {
					void window.agent567.ssh
						.removeHost(host.id)
						.then(() => refresh())
						.catch((error: unknown) => {
							// 主机仍被项目引用是最常见的失败，原因要让用户看见而不是静默失败。
							setRowMessage((previous) => ({
								...previous,
								[host.id]: { tone: "error", text: toMessage(error) },
							}));
						});
				},
			});
		},
		[refresh, setConfirm, t],
	);

	const importFromConfig = useCallback(async () => {
		setImporting(true);
		try {
			const aliases = await window.agent567.ssh.listConfigAliases();
			const added = await window.agent567.ssh.importFromConfig(aliases);
			await refresh();
			setConfirm({
				title: t("sshImportFromConfig"),
				message: added.length === 0 ? t("sshImportNone") : t("sshImportDone", { count: added.length }),
				variant: "default",
				onConfirm: () => {},
			});
		} finally {
			setImporting(false);
		}
	}, [refresh, setConfirm, t]);

	const labels = useMemo<SshHostsSettingsLabels>(
		() => ({
			title: t("tabSshHosts"),
			description: t("sshHostsDescription"),
			loading: t("loading"),
			section: t("section_ssh-hosts-list"),
			add: t("sshAddHost"),
			addTitle: t("sshAddHost"),
			editTitle: t("sshEditHost"),
			save: t("sshSaveHost"),
			cancel: t("cancel"),
			empty: t("sshHostsEmpty"),
			emptyHint: t("sshHostsEmptyHint"),
			importFromConfig: t("sshImportFromConfig"),
			importNone: t("sshImportNone"),
			importDone: t("sshImportDone", { count: 0 }),
			fieldLabel: t("sshFieldLabel"),
			fieldLabelHint: t("sshFieldLabelHint"),
			fieldHost: t("sshFieldHost"),
			fieldHostHint: t("sshFieldHostHint"),
			fieldUsername: t("sshFieldUsername"),
			fieldUsernameHint: t("sshFieldUsernameHint"),
			passwordIgnoresConfigKey: t("sshPasswordIgnoresConfigKey"),
			fieldPort: t("sshFieldPort"),
			fieldIdentityFile: t("sshFieldIdentityFile"),
			fieldIdentityFileHint: t("sshFieldIdentityFileHint"),
			pickPrivateKey: t("sshPickPrivateKey"),
			replacePrivateKey: t("sshReplacePrivateKey"),
			discardPrivateKey: t("sshDiscardPrivateKey"),
			privateKeyPending: t("sshPrivateKeyPending"),
			authKey: t("sshAuthKey"),
			authPassword: t("sshAuthPassword"),
			fieldPassword: t("sshFieldPassword"),
			fieldPasswordHint: t("sshFieldPasswordHint"),
			fieldPasswordSavedHint: t("sshFieldPasswordSavedHint"),
			test: t("sshTest"),
			testing: t("sshTesting"),
			testDetails: t("sshTestDetails"),
			edit: t("sshEditHost"),
			remove: t("sshRemove"),
			removeTitle: t("sshRemoveTitle"),
			removeConfirm: t("sshRemoveConfirm", { name: "" }),
			statusConnected: t("sshStatusConnected"),
			statusUnverifiable: t("sshStatusUnverifiable"),
			statusUnknown: t("sshStatusUnknown"),
		}),
		[t],
	);

	return {
		loading,
		hosts,
		editingId,
		form,
		saving,
		privateKeySelection,
		pickingPrivateKey,
		formError,
		testingId,
		rowMessage,
		importing,
		labels,
		actions: {
			startAdd,
			startEdit,
			cancelEdit,
			setForm,
			pickPrivateKey,
			discardPrivateKey,
			submit,
			test,
			remove,
			importFromConfig,
		},
	};
}

function discardSelection(ref: string): void {
	void window.agent567.ssh.discardPrivateKey(ref).catch(() => undefined);
}

/**
 * 探测结果分三种情况，供调用方挑文案。
 *
 * 判定与文案分开：i18n 的 key 是字面量类型，把 `t` 当参数透传过不了类型检查；拆开
 * 之后这段判断也能独立测试。
 *
 * 「连上了但缺工具」必须与「连上了」区分开：远端没有 git 时用户照样能建项目、能读写
 * 文件，只是 Agent 跑 git 会失败——报成连接失败会让他去查一台其实好好的机器。
 */
export type SshProbeOutcome =
	| { kind: "failed"; details: string }
	| { kind: "ok"; platform: string }
	| { kind: "ok-missing-tools"; platform: string; tools: string };

export function classifyProbe(probe: SshHostProbe): SshProbeOutcome {
	if (!probe.ok) return { kind: "failed", details: probe.error };
	const platform = [probe.os, probe.arch].filter(Boolean).join(" ");
	const missing = [probe.hasGit ? "" : "git", probe.hasRipgrep ? "" : "rg"].filter((tool) => tool.length > 0);
	if (missing.length === 0) return { kind: "ok", platform };
	return { kind: "ok-missing-tools", platform, tools: missing.join("、") };
}

/** `user@host` 拆成两个输入框；别名或纯主机名没有用户名。 */
export function splitTarget(target: string): { host: string; username: string } {
	const at = target.lastIndexOf("@");
	return at <= 0 ? { host: target, username: "" } : { username: target.slice(0, at), host: target.slice(at + 1) };
}

export function composeTarget(username: string, host: string): string {
	const name = username.trim();
	return name ? `${name}@${host.trim()}` : host.trim();
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
