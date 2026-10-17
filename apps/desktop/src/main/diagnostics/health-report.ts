import { constants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { app } from "electron";
import type { DiagnosticsCheck, DiagnosticsReport } from "../../shared/diagnostics-report.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { readModelsConfigSync } from "../models/model-settings-service.js";
import { getRuntimeManager } from "../runtimes/manager.js";

export type ReadRemoteHealth = () => { status: string; errorCode?: string; pairingWarnings?: readonly string[] };
export async function readHealthReport(remote?: ReadRemoteHealth): Promise<DiagnosticsReport> {
	const checks: DiagnosticsCheck[] = [];
	const runtimes = getRuntimeManager().getStatus();
	for (const id of ["node", "python"] as const) {
		const runtime = runtimes[id];
		checks.push({
			id,
			status: runtime.ready ? "ok" : runtime.supported ? "attention" : "unknown",
			detail: runtime.ready
				? (runtime.managedVersion ?? runtime.recommendedVersion)
				: runtime.repairRequiresRestart
					? "restart_required"
					: "runtime_incomplete",
		});
	}
	try {
		const config = readModelsConfigSync();
		const count = Object.values(config.providers).reduce(
			(count, provider) => count + (provider.models?.length ?? 0),
			0,
		);
		checks.push({
			id: "models",
			status: count ? "ok" : "attention",
			detail: `configured_models=${count}; no paid inference requested`,
		});
	} catch {
		checks.push({ id: "models", status: "attention", detail: "model_config_unreadable" });
	}
	checks.push({
		id: "credentials",
		status: getDesktopCredentialVault().isAvailable() ? "ok" : "attention",
		detail: "system_credential_storage_availability_only",
	});
	try {
		const root = getAgent567HomePath();
		await access(root, constants.W_OK);
		const disk = await statfs(root);
		const mb = Math.floor((disk.bavail * disk.bsize) / 1024 ** 2);
		checks.push({ id: "storage", status: mb > 500 ? "ok" : "attention", detail: `free_mb=${mb}` });
	} catch {
		checks.push({ id: "storage", status: "attention", detail: "storage_not_writable_or_unavailable" });
	}
	const mb = Math.floor(freemem() / 1024 ** 2);
	checks.push({
		id: "memory",
		status: mb > 512 ? "ok" : "attention",
		detail: `available_mb=${mb}; total_mb=${Math.floor(totalmem() / 1024 ** 2)}`,
	});
	if (remote) {
		const state = remote();
		checks.push({
			id: "remote",
			status: state.status === "connected" ? "ok" : state.status === "error" ? "attention" : "unknown",
			detail: [state.status, state.errorCode, ...(state.pairingWarnings ?? [])].filter(Boolean).join("; "),
		});
	} else checks.push({ id: "remote", status: "unknown", detail: "not_checked" });
	checks.push({
		id: "plugins",
		status: runtimes.node.ready ? "unknown" : "attention",
		detail: runtimes.node.ready ? "runtime_ready; plugin_startup_requires_opening_plugin" : "node_runtime_incomplete",
	});
	const createdAt = new Date().toISOString();
	return {
		createdAt,
		checks,
		text: JSON.stringify(
			{
				application: "567 Agent",
				version: app.getVersion(),
				platform: process.platform,
				architecture: process.arch,
				createdAt,
				checks,
				privacy:
					"No credentials, chat contents, file contents, usernames, pairing secrets or full URLs are included.",
			},
			null,
			2,
		),
	};
}
export async function repairRuntimeHealth(remote?: ReadRemoteHealth): Promise<DiagnosticsReport> {
	const manager = getRuntimeManager();
	const state = manager.redetect();
	for (const id of ["node", "python"] as const) {
		if (state[id].supported && !state[id].ready && !state[id].repairRequiresRestart) await manager.reinstall(id);
	}
	return readHealthReport(remote);
}
