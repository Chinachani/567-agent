// Regression cases from the isolated lifecycle and concurrency audit.
import { expect, it, vi } from "vitest";
import { engineFilesHash } from "../src/engine/engine-files";
import { startDesignServer, stopDesignServer, getDesignServer } from "../src/engine/engine-manager";
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
it("closing a design during startup must not leave a late server running", async () => {
	const gate = deferred(),
		entered = deferred();
	let running = false;
	const stop = vi.fn(async () => {
		running = false;
	});
	const route = "ssh://isolated-audit/home/test/design.vetd";
	const ctx = {
		command: {
			run: async (_file: string, args: string[]) => {
				if (args[0] === "-p") {
					entered.resolve();
					await gate.promise;
					return { stdout: "/audit-data", stderr: "", exitCode: 0 };
				}
				return { stdout: JSON.stringify({ hash: engineFilesHash(), vite: true }), stderr: "", exitCode: 0 };
			},
			spawn: async () => {
				running = true;
				return {
					port: 59999,
					status: async () => ({ running, pid: 1, recentOutput: "" }),
					stop,
					onExit: () => ({ dispose() {} }),
				};
			},
		},
		fs: {
			readFile: async () => {
				throw new Error("no optional package.json");
			},
		},
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true })),
	);
	try {
		const pending = startDesignServer(ctx as never, route, () => {});
		await entered.promise;
		const outcome = expect(pending).rejects.toThrow("cancelled");
		await stopDesignServer(route);
		gate.resolve();
		await outcome;
		console.log("late-design-server", {
			running,
			stopCalls: stop.mock.calls.length,
			registered: !!getDesignServer(route),
		});
		expect(running).toBe(false);
	} finally {
		await stopDesignServer(route);
		vi.unstubAllGlobals();
	}
});

it("a cancelled late spawn cannot replace or stop a reopened design server", async () => {
	const gate = deferred(),
		entered = deferred();
	const route = "ssh://isolated-reopen/home/test/design.vetd";
	const first = {
		port: 59997,
		status: async () => ({ running: true, pid: 1, recentOutput: "" }),
		stop: vi.fn(async () => {}),
		onExit: () => ({ dispose() {} }),
	};
	const second = { ...first, port: 59998, stop: vi.fn(async () => {}) };
	let calls = 0;
	const ctx = {
		command: {
			run: async (_file: string, args: string[]) => ({
				stdout: args[0] === "-p" ? "/reopen-data" : JSON.stringify({ hash: engineFilesHash(), vite: true }),
				stderr: "",
				exitCode: 0,
			}),
			spawn: async () => {
				if (++calls === 1) {
					entered.resolve();
					await gate.promise;
					return first;
				}
				return second;
			},
		},
		fs: {
			readFile: async () => {
				throw new Error("no optional package.json");
			},
		},
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true })),
	);
	try {
		const old = startDesignServer(ctx as never, route, () => {});
		await entered.promise;
		const rejected = expect(old).rejects.toThrow("cancelled");
		await stopDesignServer(route);
		const reopened = await startDesignServer(ctx as never, route, () => {});
		gate.resolve();
		await rejected;
		expect(first.stop).toHaveBeenCalledOnce();
		expect(second.stop).not.toHaveBeenCalled();
		expect(getDesignServer(route)).toBe(reopened);
	} finally {
		gate.resolve();
		await stopDesignServer(route);
		vi.unstubAllGlobals();
	}
});
