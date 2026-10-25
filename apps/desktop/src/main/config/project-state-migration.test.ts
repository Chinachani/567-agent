import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopRuntimeSessionCatalog } from "@567agent/runtime-desktop";
import { FileConversationRepository } from "@567agent/runtime-node/conversation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	root: "",
	config: { workspacePath: "", projects: [] as { path: string; name?: string }[], archivedProjects: [] },
}));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
vi.mock("./desktop-config-store.js", () => ({
	get DEFAULT_CONVERSATION_CWD() {
		return join(state.root, "conversation");
	},
	get DEFAULT_CONVERSATION_SESSION_DIR() {
		return join(state.root, "conversation/.567agent/sessions");
	},
	get DEFAULT_IM_CONVERSATION_CWD() {
		return join(state.root, "im");
	},
	get DEFAULT_IM_CONVERSATION_SESSION_DIR() {
		return join(state.root, "im/.567agent/sessions");
	},
	get KB_PROCESSING_CWD() {
		return join(state.root, "kb");
	},
	get KB_PROCESSING_SESSION_DIR() {
		return join(state.root, "kb/.567agent/sessions");
	},
	readConfigSync: () => state.config,
	readDesktopConfig: async () => state.config,
	updateDesktopConfig: async (change: (config: typeof state.config) => typeof state.config) => {
		state.config = change(state.config);
		return state.config;
	},
}));

import { loadProjectTaskStates, saveTaskState } from "../batch-tasks/batch-task-state.js";
import { createProject, getProject, resetProjectFiles, updateProject } from "../batch-tasks/batch-task-storage.js";
import { resolveDesktopRuntimeSessionRoots } from "../conversations/session-catalog-roots.js";
import { existingProjectStatePath } from "./project-state-paths.js";

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), "agent567-state-migration-"));
	state.config = { workspacePath: state.root, projects: [], archivedProjects: [] };
});
afterEach(async () => {
	vi.useRealTimers();
	await rm(state.root, { recursive: true, force: true });
});

it("reads legacy batch state, writes canonical metadata and keeps reset projects discoverable", async () => {
	const project = await createProject("Batch", "first", undefined, [], 1);
	const canonical = join(project.id, ".567agent");
	await expect(stat(join(canonical, "sessions"))).resolves.toBeDefined();
	await expect(stat(join(project.id, ".vetta"))).rejects.toMatchObject({ code: "ENOENT" });
	const meta = await readFile(join(canonical, "meta.json"), "utf8");
	await mkdir(join(project.id, ".vetta"));
	await writeFile(join(project.id, ".vetta/meta.json"), meta);
	await rm(canonical, { recursive: true });
	await writeFile(
		join(project.id, ".vetta/task-states.json"),
		JSON.stringify({ old: { taskId: "old", status: "completed", lastModified: 1 } }),
	);
	expect((await loadProjectTaskStates(project.id)).old.status).toBe("completed");
	await updateProject(project.id, { prompt: "current" });
	expect((await getProject(project.id))?.prompt).toBe("current");
	expect(await readFile(join(project.id, ".vetta/meta.json"), "utf8")).toBe(meta);
	vi.useFakeTimers();
	await saveTaskState(project.id, "new", { taskId: "new", status: "completed", lastModified: 2 });
	await vi.advanceTimersByTimeAsync(60);
	vi.useRealTimers();
	await vi.waitFor(async () => {
		expect(JSON.parse(await readFile(join(canonical, "task-states.json"), "utf8")).new.status).toBe("completed");
	});
	await resetProjectFiles(project.id);
	expect((await getProject(project.id))?.prompt).toBe("current");
});
it("lists both legacy and canonical default and project conversations without moving files", async () => {
	const project = join(state.root, "Project");
	state.config.projects.push({ path: project });
	const roots = resolveDesktopRuntimeSessionRoots().filter((root) => root.sessionDir.startsWith(state.root));
	for (const [index, directory] of [join(project, ".vetta/sessions"), join(project, ".567agent/sessions")].entries()) {
		const repository = new FileConversationRepository({ rootDir: directory });
		await repository.create({ sessionId: `history-${index}`, createdAt: 1, cwd: project });
		await repository.close();
	}
	const catalog = new DesktopRuntimeSessionCatalog({ resolveRoots: () => roots });
	expect((await catalog.listSessions(project)).map((s) => s.id).sort()).toEqual(["history-0", "history-1"]);
	expect(roots.some((root) => root.sessionDir === join(state.root, "im/.vetta/sessions"))).toBe(true);
	expect(roots.some((root) => root.sessionDir === join(state.root, "im/.567agent/sessions"))).toBe(true);
});
it("does not fall back to stale legacy metadata when the canonical file is corrupt", async () => {
	const project = await createProject("Broken", "first", undefined, [], 1);
	await mkdir(join(project.id, ".vetta"));
	await writeFile(join(project.id, ".vetta/meta.json"), await readFile(join(project.id, ".567agent/meta.json")));
	await writeFile(join(project.id, ".567agent/meta.json"), "invalid json");
	expect(existingProjectStatePath(project.id, "meta.json")).toBe(join(project.id, ".567agent/meta.json"));
	expect(await getProject(project.id)).toBeUndefined();
});
