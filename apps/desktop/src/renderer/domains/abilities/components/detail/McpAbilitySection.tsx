import { Button } from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { useMcpSetupStatusModel } from "../../hooks/useMcpSetupStatusModel";
import type { AbilitiesModel, McpAbility } from "../../types";

/** Lightweight login state for managed MCP abilities; advanced configuration stays in Settings. */
export function McpAbilitySection({
	item,
	model,
}: {
	item: McpAbility;
	model: AbilitiesModel;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const status = useMcpSetupStatusModel(item, model.refresh, model.setupPromptId);
	const metadata = item.mcpMetadata;
	if (!status && !metadata) return null;

	const preparingQrCode = Boolean(status && model.setupPromptId === item.id);
	const authenticated = status?.phase === "authenticated";
	const label = !status
		? ""
		: preparingQrCode
		? t("mcp.setupLoginPreparing")
		: authenticated
			? status.username
				? t("mcp.loginAuthenticatedAs", { username: status.username })
				: t("mcp.loginAuthenticated")
				: status.phase === "checking"
				? t("mcp.loginChecking")
				: status.phase === "failed"
					? t("mcp.loginCheckFailed", { error: status.error ?? "" })
					: t("mcp.loginUnauthenticated");

	return (
		<div className="flex flex-col gap-6">
			{metadata ? (
				<section className="flex flex-col gap-3">
					<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
						{t("mcp.metadataTitle")}
					</h2>
					<dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[12px] sm:grid-cols-2">
						<MetadataRow label={t("mcp.publisherType")} value={t(`mcp.publisherTypes.${metadata.publisherType}`)} />
						<MetadataRow label={t("mcp.runtimeMode")} value={t(`mcp.runtimeModes.${metadata.runtimeMode}`)} />
						<MetadataRow label={t("mcp.platforms")} value={metadata.platforms.map((value) => t(`mcp.platformValues.${value}`)).join(", ")} />
						<MetadataRow label={t("mcp.permissionScopes")} value={metadata.permissionScopes.map((value) => t(`mcp.permissionValues.${value}`)).join(", ")} />
						<MetadataRow label={t("mcp.authentication")} value={t(`mcp.authenticationValues.${metadata.authentication}`)} />
					</dl>
					{!metadata.installable ? (
						<p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{t("mcp.discoveryOnly")}</p>
					) : null}
				</section>
			) : null}
			{status ? <section className="flex flex-col gap-3" aria-live="polite">
				<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
					{t("mcp.loginStatusTitle")}
				</h2>
				<div className="flex items-center justify-between gap-4 py-1">
				<div className="flex min-w-0 items-center gap-2.5">
					<span
						className={
							preparingQrCode || status.phase === "checking"
								? "icon-[solar--refresh-linear] h-4 w-4 shrink-0 animate-spin text-muted-foreground"
								: authenticated
									? "icon-[solar--check-circle-linear] h-4 w-4 shrink-0 text-emerald-400"
									: "icon-[solar--danger-circle-linear] h-4 w-4 shrink-0 text-muted-foreground"
						}
					/>
					<p className="text-[12px] text-muted-foreground">{label}</p>
				</div>
				{status.phase === "failed" && !preparingQrCode ? (
					<Button variant="outline" size="sm" onClick={status.retry}>
						{t("mcp.loginCheckRetry")}
					</Button>
				) : !authenticated ? (
					<Button variant="primary" size="sm" disabled={preparingQrCode} onClick={() => model.setup(item)}>
						{t("mcp.loginAction")}
					</Button>
				) : null}
				</div>
			</section> : null}
		</div>
	);
}

function MetadataRow({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="flex flex-col gap-1">
			<dt className="text-[11px] text-muted-foreground/60">{label}</dt>
			<dd className="text-foreground/90">{value}</dd>
		</div>
	);
}
