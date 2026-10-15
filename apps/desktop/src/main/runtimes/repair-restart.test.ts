import { describe, expect, it, vi } from "vitest";
import { RuntimeRepairRestarter } from "./repair-restart";

vi.mock("electron", () => ({ app: {} }));
vi.mock("./manager.js", () => ({ getRuntimeManager: vi.fn() }));

describe("restart and repair", () => {
	it("saves repair intent before shutdown and waits for application cleanup before exit", async () => {
		const order: string[] = [];
		let finishCleanup!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			finishCleanup = resolve;
		});
		const restarter = new RuntimeRepairRestarter({
			scheduleRepair: (type) => {
				order.push(`save:${type}`);
			},
			relaunch: () => {
				order.push("relaunch");
			},
			prepareQuit: () => {
				order.push("prepare");
			},
			cleanup: () => cleanup,
			exit: () => {
				order.push("exit");
			},
		});
		const first = restarter.restart("node");
		const second = restarter.restart("python");
		expect(first).toBe(second);
		expect(order).toEqual(["save:node", "relaunch", "prepare", "save:python"]);
		finishCleanup();
		await first;
		expect(order).not.toContain("exit");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(order.at(-1)).toBe("exit");
	});

	it("keeps the app running if repair intent cannot be saved", () => {
		const relaunch = vi.fn();
		const exit = vi.fn();
		const restarter = new RuntimeRepairRestarter({
			scheduleRepair: () => {
				throw new Error("write denied");
			},
			relaunch,
			exit,
			prepareQuit: vi.fn(),
			cleanup: vi.fn(),
		});
		expect(() => restarter.restart("node")).toThrow("write denied");
		expect(relaunch).not.toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
	});
});
