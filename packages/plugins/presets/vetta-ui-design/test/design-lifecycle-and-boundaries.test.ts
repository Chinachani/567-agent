// Regression cases from the isolated lifecycle and concurrency audit.
import { mkdtemp, readFile, writeFile, mkdir, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { it, expect, vi } from "vitest";
vi.mock("../src/history/history-bootstrap.ts", () => ({ bootstrapHistory: async () => {} }));
import { DesignSession } from "../src/vetd/design-session";
import { installDesignDependencies } from "../src/engine/engine-manager";
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
it("disposing a design while it opens must leave no directory watchers", async () => {
	const gate = deferred(),
		entered = deferred();
	let active = 0;
	const fs = {
		readFile: async (path: string) => {
			if (path.endsWith("design.json")) {
				entered.resolve();
				await gate.promise;
			}
			throw new Error("ENOENT");
		},
		readDir: async () => [],
		writeFile: async () => {},
		watchDirectory: () => {
			active++;
			return {
				dispose() {
					active--;
				},
			};
		},
	};
	const session = new DesignSession({ fs } as never, "/audit/design.vetd");
	const opening = session.open();
	await entered.promise;
	session.dispose();
	gate.resolve();
	await opening;
	console.log("disposed-session", { activeWatchers: active });
	try {
		expect(active).toBe(0);
	} finally {
		session.dispose();
	}
});
it("deleting a frame from an imported manifest must not delete a sibling project file", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent567-audit-manifest-"));
	let session: DesignSession | undefined;
	try {
		const dir = join(root, "design.vetd"),
			victim = join(root, "existing.txt");
		await mkdir(join(dir, "frames"), { recursive: true });
		await writeFile(victim, "USER ORIGINAL");
		await writeFile(
			join(dir, "frames/home.tsx"),
			'export const frame={width:390,height:844,title:"Home"}; export default function F(){return null;}',
		);
		await writeFile(
			join(dir, "design.json"),
			JSON.stringify({
				type: "vetta-design",
				version: 1,
				canvas: { x: 0, y: 0, zoom: 1 },
				frames: [
					{
						id: "home",
						file: "../existing.txt",
						x: 0,
						y: 0,
						width: 390,
						height: 844,
						title: "Home",
						meta: { width: 390, height: 844, title: "Home" },
					},
				],
			}),
		);
		const safe = (p: string) => {
			const v = resolve(p);
			if (!v.startsWith(root + sep)) throw new Error("outside project");
			return v;
		};
		const fs = {
			readFile: async (p: string) => ({ content: await readFile(safe(p), "utf8") }),
			readDir: async (p: string) =>
				(await readdir(safe(p), { withFileTypes: true })).map((e) => ({
					name: e.name,
					path: join(p, e.name),
					isDirectory: e.isDirectory(),
				})),
			writeFile: async (p: string, s: string) => {
				await mkdir(dirname(safe(p)), { recursive: true });
				await writeFile(safe(p), s);
			},
			delete: async (p: string) => rm(safe(p)),
			watchDirectory: () => ({ dispose() {} }),
		};
		session = new DesignSession({ fs } as never, dir);
		await session.open();
		await session.deleteFrame("home");
		const exists = await stat(victim).then(
			() => true,
			() => false,
		);
		console.log("manifest-frame-containment", {
			frameFile: session.manifest.frames[0]?.file,
			siblingFileExists: exists,
		});
		expect(exists).toBe(true);
	} finally {
		session?.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
it("dependency install must observe a process that exited before the exit listener attached", async () => {
	vi.useFakeTimers();
	let subscribed = 0;
	const statuses = vi.fn(async () => ({
		running: false,
		pid: 1,
		recentOutput: "npm failed immediately",
		exit: { exitCode: 1, signal: null },
	}));
	let result = "pending";
	const ctx = {
		fs: { stat: async () => ({ isDirectory: false }) },
		command: {
			spawn: async () => ({
				status: statuses,
				onExit: () => {
					subscribed++;
					return { dispose() {} };
				},
			}),
		},
	};
	void installDesignDependencies(ctx as never, "/audit/design.vetd", ["safe-test-package"], () => {}).then(
		() => {
			result = "resolved";
		},
		() => {
			result = "rejected";
		},
	);
	try {
		await vi.advanceTimersByTimeAsync(3000);
		console.log("early-npm-exit", { result, subscribed, statusReads: statuses.mock.calls.length });
		expect(result).toBe("rejected");
	} finally {
		vi.clearAllTimers();
		vi.useRealTimers();
	}
});
