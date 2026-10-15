import { app } from "electron";
import { runQuitCleanup } from "../quit-cleanup.js";
import { getRuntimeManager } from "./manager.js";
import type { RuntimeType } from "./types.js";

interface RuntimeRepairRestartDependencies {
	scheduleRepair(type: RuntimeType): void;
	relaunch(): void;
	prepareQuit(): void;
	cleanup(): Promise<void>;
	exit(): void;
}

export class RuntimeRepairRestarter {
	private restarting: Promise<void> | undefined;
	constructor(private readonly dependencies: RuntimeRepairRestartDependencies) {}

	restart(type: RuntimeType): Promise<void> {
		// Persist before shutting down: even an interrupted exit keeps the user's
		// repair request, and a failed write leaves the running app untouched.
		this.dependencies.scheduleRepair(type);
		if (this.restarting) return this.restarting;
		const operation = this.restartApplication();
		this.restarting = operation;
		void operation.catch(() => {
			this.restarting = undefined;
		});
		return operation;
	}

	private async restartApplication(): Promise<void> {
		this.dependencies.relaunch();
		this.dependencies.prepareQuit();
		try {
			await this.dependencies.cleanup();
		} finally {
			// Let the IPC response settle before ending the process. Relaunch only
			// takes effect after exit; the normal app.quit path can retain handles.
			setImmediate(() => this.dependencies.exit());
		}
	}
}

export const runtimeRepairRestarter = new RuntimeRepairRestarter({
	scheduleRepair: (type) => getRuntimeManager().scheduleRepair(type),
	relaunch: () => app.relaunch(),
	prepareQuit: () => {
		(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
	},
	cleanup: runQuitCleanup,
	exit: () => app.exit(0),
});
