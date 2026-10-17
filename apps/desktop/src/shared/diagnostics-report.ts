export interface DiagnosticsCheck {
	readonly id: "node" | "python" | "models" | "credentials" | "storage" | "memory" | "remote" | "plugins";
	readonly status: "ok" | "attention" | "unknown";
	readonly detail: string;
}
export interface DiagnosticsReport {
	readonly createdAt: string;
	readonly checks: readonly DiagnosticsCheck[];
	readonly text: string;
}
