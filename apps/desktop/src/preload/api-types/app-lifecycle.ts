import type { DesignShareOpenEvent } from "../../shared/app-lifecycle-ipc.js";

export interface DesktopAppLifecycleApi {
	reportRendererBootPainted(): void;
	reportRendererContentPainted(): void;
	whenReady(): Promise<void>;
	onDesignShareOpen(handler: (event: DesignShareOpenEvent) => void): () => void;
}
