import { isQuitCleanupStarted } from "../quit-cleanup.js";
import { listPlugins } from "./plugin-catalog.js";

export function assertPluginCommandAllowed(
	pluginId: string,
	file: string,
	permission: "agent.command.run" | "agent.command.spawn",
): void {
	if (isQuitCleanupStarted()) throw new Error("Plugin command cancelled during application shutdown");
	if (typeof pluginId !== "string" || pluginId.trim().length === 0) throw new Error("Invalid plugin id");
	if (typeof file !== "string" || file.trim().length === 0) throw new Error("Invalid command file");
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
	if (!plugin.permissions.includes(permission) || !plugin.grantedPermissions.includes(permission))
		throw new Error(`Plugin permission denied: ${permission}`);
	if (!plugin.declaredCommands.includes(file)) throw new Error(`Command not declared: ${file}`);
	if (!plugin.grantedCommandNames.includes(file)) throw new Error(`Command disabled by user: ${file}`);
}
