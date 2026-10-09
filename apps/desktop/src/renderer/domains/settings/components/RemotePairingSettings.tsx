import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Switch } from "@shared/components/ui/switch";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemotePairingState } from "../../../../preload/api-types/remote-pairing";
import { createQrCodeDataUrl } from "@shared/lib/qr-code-data-url";

const DEFAULT_RELAY = "https://567-agent-relay.907746241.workers.dev";

export function RemotePairingSettings(): JSX.Element {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<RemotePairingState>({
		status: "idle",
		autoShareScreen: false,
		inputEnabled: false,
		inputSupported: false,
	});
	const [relayUrl, setRelayUrl] = useState(() => {
		return toHttpsRelayBaseUrl(localStorage.getItem("567.remote.relay_url") || DEFAULT_RELAY);
	});
	const relayUrlEdited = useRef(false);
	const [qr, setQr] = useState<string>();
	const [qrError, setQrError] = useState(false);
	const [createError, setCreateError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [installingInput, setInstallingInput] = useState(false);
	const [inputInstallResult, setInputInstallResult] = useState<"success" | "error" | undefined>();

	useEffect(() => {
		const sync = (): void => {
			void window.agent567.remotePairing.getState().then((next) => {
				setState(next);
				if (next.relayBaseUrl && !relayUrlEdited.current) {
					setRelayUrl(toHttpsRelayBaseUrl(next.relayBaseUrl));
				}
			});
		};
		sync();
		const timer = window.setInterval(sync, 1000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!state.inviteUri) {
			setQr(undefined);
			setQrError(false);
			return;
		}
		let cancelled = false;
		setQr(undefined);
		setQrError(false);
		setCreateError(undefined);
		void createQrCodeDataUrl(state.inviteUri, 280)
			.then((dataUrl) => {
				if (!cancelled) setQr(dataUrl);
			})
			.catch(() => {
				if (!cancelled) setQrError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [state.inviteUri]);

	const statusLabel = useMemo(() => t(`remote.status.${state.status}`), [state.status, t]);

	const create = async (): Promise<void> => {
		setBusy(true);
		setQr(undefined);
		setQrError(false);
		setCreateError(undefined);
		try {
			const targetRelay = relayUrl.trim() || DEFAULT_RELAY;
			localStorage.setItem("567.remote.relay_url", toHttpsRelayBaseUrl(targetRelay));
			setCreateError(undefined);
			const next = await window.agent567.remotePairing.create(targetRelay);
			setState(next);
			if (next.relayBaseUrl) {
				const canonicalRelay = toHttpsRelayBaseUrl(next.relayBaseUrl);
				setRelayUrl(canonicalRelay);
				localStorage.setItem("567.remote.relay_url", canonicalRelay);
			}
		} catch (error) {
			setCreateError(error instanceof Error ? error.message : t("remote.createFailed"));
			setState((current) => ({ ...current, status: "error" }));
		} finally {
			setBusy(false);
		}
	};

	const resetCertificate = async (): Promise<void> => {
		if (!window.confirm(t("remote.resetCertificateConfirm"))) return;
		setBusy(true);
		setQr(undefined);
		setQrError(false);
		setCreateError(undefined);
		try {
			const targetRelay = relayUrl.trim() || DEFAULT_RELAY;
			localStorage.setItem("567.remote.relay_url", toHttpsRelayBaseUrl(targetRelay));
			const next = await window.agent567.remotePairing.resetCertificate(targetRelay);
			setState(next);
			if (next.relayBaseUrl) {
				const canonicalRelay = toHttpsRelayBaseUrl(next.relayBaseUrl);
				setRelayUrl(canonicalRelay);
				localStorage.setItem("567.remote.relay_url", canonicalRelay);
			}
		} catch (error) {
			setCreateError(error instanceof Error ? error.message : t("remote.createFailed"));
			setState((current) => ({ ...current, status: "error" }));
		} finally {
			setBusy(false);
		}
	};

	const setInputEnabled = async (enabled: boolean): Promise<void> => {
		try {
			setState(await window.agent567.remotePairing.setInputEnabled(enabled));
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		}
	};

	const setAutoShareScreen = async (enabled: boolean): Promise<void> => {
		try {
			setState(await window.agent567.remotePairing.setAutoShareScreen(enabled));
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		}
	};

	const installInputDependencies = async (): Promise<void> => {
		setInstallingInput(true);
		setInputInstallResult(undefined);
		try {
			await window.agent567.remotePairing.installInputDependencies();
			setInputInstallResult("success");
		} catch {
			setInputInstallResult("error");
		} finally {
			setInstallingInput(false);
		}
	};

	const revoke = async (): Promise<void> => {
		try {
			setState(await window.agent567.remotePairing.revoke());
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		}
	};

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-8">
			<div className="mb-6">
				<h1 className="text-[20px] font-bold text-foreground">{t("remote.title")}</h1>
				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("remote.description")}</p>
			</div>

			<section id="remote-pairing" className="mb-7">
				<div className="mb-3 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.pairingTitle")}</h2>
						<p className="mt-1 text-[12px] text-muted-foreground">{t("remote.pairingDescription")}</p>
					</div>
					<span
						className={
							state.status === "ready"
								? "text-[12px] text-emerald-400"
								: "text-[12px] text-muted-foreground"
						}
					>
						{statusLabel}
					</span>
				</div>

				{/* 自定义中继服务器地址输入 */}
				<div className="mb-4 flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-3">
					<div className="flex items-center justify-between">
						<label htmlFor="relay-url-input" className="text-[12px] font-medium text-foreground">
							{t("remote.relayUrlLabel")}
						</label>
						{relayUrl !== DEFAULT_RELAY && (
							<button
								type="button"
								className="text-[11px] text-primary hover:underline"
								onClick={() => {
									relayUrlEdited.current = true;
									setRelayUrl(DEFAULT_RELAY);
									localStorage.removeItem("567.remote.relay_url");
								}}
							>
								{t("remote.resetDefaultRelay")}
							</button>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Input
							id="relay-url-input"
							type="url"
							value={relayUrl}
							onChange={(e) => {
								relayUrlEdited.current = true;
								setRelayUrl(e.target.value);
							}}
							placeholder={DEFAULT_RELAY}
							className="h-8 flex-1 text-xs font-mono"
						/>
						<Button onClick={() => void create()} disabled={busy} size="sm" className="h-8 gap-1.5">
							<span className="icon-[solar--qr-code-linear] h-4 w-4" />
							{busy ? t("remote.creating") : t("remote.create")}
						</Button>
					</div>
					<p className="text-[11px] leading-tight text-muted-foreground">{t("remote.relayUrlHint")}</p>
				</div>

				<div className="mt-4 min-h-[310px] overflow-hidden border-y border-border/50 py-5">
					{state.pairingWarnings?.map((warning) => (
						<div
							key={warning}
							className="mb-4 flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200"
						>
							<p>{t(`remote.warning.${warning}`)}</p>
							{warning === "certificate_changed" ? (
								<Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>
									{t("remote.create")}
								</Button>
							) : null}
						</div>
					))}
					{createError ? <p role="alert" className="mb-3 text-center text-[12px] text-destructive">{createError}</p> : null}
					{qr ? (
						<div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
							<img
								src={qr}
								alt={t("remote.qrAlt")}
								className="h-[280px] w-[280px] rounded-lg bg-white p-2"
								onError={() => {
									setQr(undefined);
									setQrError(true);
								}}
							/>
							<p className="mt-3 max-w-[360px] text-center text-[12px] leading-relaxed text-muted-foreground">
								{t("remote.qrHint")}
							</p>
						</div>
					) : (
						<div className="flex min-h-[270px] flex-col items-center justify-center text-muted-foreground">
							<span className="icon-[solar--smartphone-rotate-angle-linear] h-9 w-9" />
							<p role={qrError ? "alert" : undefined} className={`mt-3 text-[12px] ${qrError ? "text-destructive" : ""}`}>
								{qrError ? t("remote.qrRenderError") : t("remote.empty")}
							</p>
						</div>
					)}
				</div>
				{state.pairingId ? (
					<div className="mt-3 flex justify-end">
						<Button variant="outline" size="sm" disabled={busy} onClick={() => void resetCertificate()}>
							<span className="icon-[solar--key-minimalistic-square-3-linear] h-4 w-4" />
							{t("remote.resetCertificate")}
						</Button>
					</div>
				) : null}
			</section>

			<section id="remote-permissions">
				{state.pairingId ? (
					<div className="flex items-center justify-between gap-4 border-b border-border/50 py-3">
						<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.autoShareTitle")}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
							{t("remote.autoShareDescription")}
						</p>
					</div>
					<Switch
						checked={state.autoShareScreen}
						disabled={state.status === "error"}
						onCheckedChange={(enabled) => void setAutoShareScreen(enabled)}
					/>
					</div>
				) : null}
				<div className="flex items-center justify-between gap-4 py-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.inputTitle")}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
							{state.inputSupported || !state.inputSupportReason
								? t("remote.inputDescription")
								: t(`remote.inputSupport.${state.inputSupportReason}`)}
						</p>
					</div>
					<Switch
						checked={state.inputEnabled}
						disabled={(state.status !== "ready" && state.status !== "connected") || !state.inputSupported}
						onCheckedChange={(enabled) => void setInputEnabled(enabled)}
					/>
				</div>
				{state.inputSupportReason === "x11_libraries_unavailable" ? (
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<Button variant="outline" size="sm" disabled={installingInput} onClick={() => void installInputDependencies()}>
							{installingInput ? t("remote.installingInputDependencies") : t("remote.installInputDependencies")}
						</Button>
						{inputInstallResult ? (
							<p role={inputInstallResult === "error" ? "alert" : "status"} className="text-[12px] text-muted-foreground">
								{t(`remote.inputInstall.${inputInstallResult}`)}
							</p>
						) : null}
					</div>
				) : null}
				{state.status === "ready" || state.status === "connected" ? (
					<Button variant="outline" onClick={() => void revoke()}>
						<span className="icon-[solar--link-broken-linear] h-4 w-4" />
						{t("remote.revoke")}
					</Button>
				) : null}
			</section>
		</div>
	);
}

function toHttpsRelayBaseUrl(value: string): string {
	try {
		const parsed = new URL(value.trim());
		if (parsed.protocol === "wss:") parsed.protocol = "https:";
		return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
	} catch {
		return value.trim();
	}
}
