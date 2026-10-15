import type { CommandToolName } from "./command-tool.js";

export function createCommandToolDescription(toolName: CommandToolName): string {
	const platformNote = toolName === "shell" ? "\n\nOn Windows, this tool uses PowerShell by default." : "";
	return `Execute a ${toolName} command in the current working directory. Returns stdout and stderr. Output may be truncated and saved to a temporary file. Supports foreground execution, timeout, and managed background execution. Verify external CLI parameter units with --help before large image, tile, array or batch operations. Host resource protection may stop excessive memory or output; reduce dimensions, batch size or concurrency before retrying, and do not bypass the limits.${platformNote}`;
}
