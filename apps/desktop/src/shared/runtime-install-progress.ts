export interface RuntimeInstallProgress {
	type: "node" | "python";
	phase: "preparing" | "downloading" | "installing" | "verifying" | "ready" | "error";
	downloadedBytes?: number;
	totalBytes?: number;
	message: string;
	updatedAt: number;
}
