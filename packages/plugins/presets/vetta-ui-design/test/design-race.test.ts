// Regression cases from the isolated lifecycle and concurrency audit.
import { expect, it, vi } from "vitest";
vi.mock("../src/history/history-bootstrap.ts", () => ({ bootstrapHistory: async () => {} }));
import { DesignSession } from "../src/vetd/design-session";
const dir = "/isolated/design.vetd";
const source = (title: string) =>
	`export const frame = { width: 390, height: 844, title: "${title}" };\nexport default function F() { return null; }`;
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function fixture() {
	const files = new Map([
		[`${dir}/frames/home.tsx`, source("Home")],
		[`${dir}/frames/detail.tsx`, source("Detail")],
	]);
	const fs = {
		readFile: vi.fn(async (path: string) => {
			if (!files.has(path)) throw new Error("ENOENT");
			return { content: files.get(path)! };
		}),
		writeFile: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
		}),
		delete: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		stat: async (path: string) => (files.has(path) ? { isDirectory: false } : null),
		readDir: async (path: string) =>
			[...files.keys()]
				.filter((f) => f.startsWith(path + "/") && !f.slice(path.length + 1).includes("/"))
				.map((f) => ({ name: f.slice(path.length + 1), path: f, isDirectory: false })),
		watchDirectory: () => ({ dispose() {} }),
	};
	const session = new DesignSession({ fs } as never, dir);
	await session.open();
	return { session, fs, files };
}
it("undo must not consume a new edit recorded while file deletion is pending", async () => {
	const { session, fs } = await fixture();
	try {
		const id = await session.createFrame("New", 390, 844, 2000, 0);
		const entered = deferred(),
			resume = deferred();
		const original = fs.delete.getMockImplementation()!;
		fs.delete.mockImplementation(async (path) => {
			entered.resolve();
			await resume.promise;
			await original(path);
		});
		const undo = session.undo();
		await entered.promise;
		session.updateFramePlacement("home", { x: 1234 }, "move");
		resume.resolve();
		await undo;
		const next = session.undoHistory.undoTop;
		console.log("undo-race", { undoneFrame: id, undoTop: next, redoTop: session.undoHistory.redoTop });
		expect(next).toMatchObject({ type: "patch", kind: "move" });
	} finally {
		session.dispose();
	}
});
it("undo rename must reject a source title edited externally before the watcher catches up", async () => {
	const { session, files } = await fixture();
	try {
		await session.renameFrame("home", "User title");
		files.set(`${dir}/frames/home.tsx`, source("Agent newer title"));
		const outcome = await session.undo();
		console.log("rename-race", { outcome, source: files.get(`${dir}/frames/home.tsx`) });
		expect(outcome.status).toBe("conflict");
		expect(files.get(`${dir}/frames/home.tsx`)).toContain("Agent newer title");
	} finally {
		session.dispose();
	}
});
it("two overlapping create actions must allocate distinct frames", async () => {
	const { session, files } = await fixture();
	try {
		const ids = await Promise.all([
			session.createFrame("First", 390, 844, 2000, 0),
			session.createFrame("Second", 390, 844, 2500, 0),
		]);
		console.log("create-race", {
			ids,
			frameCount: session.manifest.frames.length,
			source: files.get(`${dir}/frames/${ids[0]}.tsx`),
		});
		expect(new Set(ids).size).toBe(2);
	} finally {
		session.dispose();
	}
});
