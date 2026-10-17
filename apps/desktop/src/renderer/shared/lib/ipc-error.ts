/** Electron adds private transport details to invoke failures; preserve only the original cause for display. */
export function ipcErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+':\s*(?:[\w.]*Error:\s*)?/, "");
}
