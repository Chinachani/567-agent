import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { ProjectCollaborationDocument, ProjectCollaborationTask } from "../../shared/project-collaboration.js";
import { CollaborationScheduler } from "./scheduler.js";
import { createDefaultProjectCollaborationDocument } from "./store.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

function task(id: string): ProjectCollaborationTask {
	return {
		id,
		rootId: id,
		requestKey: id,
		sourceSessionId: "coordinator",
		targetSessionId: id,
		kind: "task",
		access: "write",
		objective: "Update a file",
		status: "queued",
		createdAt: 1,
		reviewRound: 0,
	};
}

it("runs independent writers in parallel, serializes the same directory, and caps project concurrency", async () => {
	const cwd = resolve("project");
	const firstTree = resolve("first-tree");
	const secondTree = resolve("second-tree");
	const thirdTree = resolve("third-tree");
	const paths = new Map([
		["tree-a", firstTree],
		["tree-b", secondTree],
		["tree-c", thirdTree],
	]);
	const initial = createDefaultProjectCollaborationDocument();
	let document: ProjectCollaborationDocument = {
		...initial,
		config: { ...initial.config, enabled: true },
		tasks: ["shared-a", "shared-b", "tree-a", "tree-b", "tree-c"].map(task),
	};
	const pending = new Map<string, () => void>();
	const execute = vi.fn(async (_project: string, current: ProjectCollaborationTask) => {
		expect(document.tasks.find(({ id }) => id === current.id)).toMatchObject({
			status: "running",
			executionCwd: paths.get(current.id) ?? cwd,
		});
		await new Promise<void>((done) => pending.set(current.id, done));
		return "done";
	});
	const scheduler = new CollaborationScheduler({
		read: async () => document,
		mutate: async (_cwd, edit) => {
			document = edit(document);
			return document;
		},
		executionCwd: (project, _document, current) => paths.get(current.targetSessionId) ?? project,
		isBusy: () => false,
		settled: () => {},
		execute,
		async complete(_cwd, current, status) {
			document = {
				...document,
				tasks: document.tasks.map((item) => (item.id === current.id ? { ...item, status } : item)),
			};
		},
	});
	const started = () => execute.mock.calls.map(([, current]) => current.id);
	try {
		scheduler.wake(cwd);
		await vi.waitFor(() => expect(started()).toEqual(["shared-a", "tree-a", "tree-b"]));
		expect(scheduler.active("tree-a")?.executionCwd).toBe(firstTree);
		pending.get("tree-a")!();
		await vi.waitFor(() => expect(started()).toEqual(["shared-a", "tree-a", "tree-b", "tree-c"]));
		pending.get("shared-a")!();
		await vi.waitFor(() => expect(started()).toEqual(["shared-a", "tree-a", "tree-b", "tree-c", "shared-b"]));
	} finally {
		const stopped = scheduler.stop(cwd);
		for (const done of pending.values()) done();
		await stopped;
	}
});
