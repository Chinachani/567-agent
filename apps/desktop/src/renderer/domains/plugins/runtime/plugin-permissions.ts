import type { InstalledPlugin } from "@preload/api";
import { i18n } from "@shared/i18n";
import type { Disposable, PluginContext, PluginPermission } from "@vetta-org/plugin-sdk";

export const noopDisposable: Disposable = { dispose: () => {} };

export class PluginPermissionError extends Error {
	constructor(
		readonly permission: PluginPermission,
		readonly reason: "undeclared" | "ungranted",
	) {
		super(`Plugin permission denied: ${permission} (${reason})`);
		this.name = "PluginPermissionError";
	}
}

export function hasPluginPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

export function createPluginPermissionApi(plugin: InstalledPlugin): PluginContext["permissions"] {
	return {
		has: (permission) => hasPluginPermission(plugin, permission),
		require: (permission) => {
			if (!hasPluginPermission(plugin, permission)) {
				throw new PluginPermissionError(
					permission,
					plugin.permissions.includes(permission) ? "ungranted" : "undeclared",
				);
			}
		},
	};
}

export function pluginPermissionRecovery(error: unknown): string | undefined {
	if (!(error instanceof PluginPermissionError)) return undefined;
	const key = error.reason === "ungranted" ? "permission.activation.ungranted" : "permission.activation.undeclared";
	return i18n.t(key, { ns: "abilities", permission: error.permission });
}

export function warnSkippedPluginContribution(
	plugin: InstalledPlugin,
	permission: PluginPermission,
	contribution: string,
): void {
	console.warn(`Plugin ${plugin.id} skipped ${contribution}: missing permission ${permission}`);
}
