import { afterEach, expect, it, vi } from "vitest";
import { createOfficialBatchTasksApi } from "./plugin-official-batch-tasks.js";
import { createOfficialSkillsApi } from "./plugin-official-skills.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

it("keeps legacy SDK scenes inert while forwarding ordinary skill installation and batch edits", async () => {
	const installFromMarketSlug = vi
		.fn()
		.mockResolvedValue({ name: "review", type: "skill", version: "1", updated: false });
	const skills = { uninstall: vi.fn() };
	const batchTasks = { createProject: vi.fn(), updateProject: vi.fn() };
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			agent567: { skills: { installFromMarketSlug }, plugins: { internalCapabilities: { skills, batchTasks } } },
		},
	});
	const skillApi = createOfficialSkillsApi(() => {}, "session");
	await expect(skillApi.uninstall("review", "scene")).rejects.toThrow("retired");
	await expect(skillApi.installFromMarket("scene", "review")).rejects.toThrow("retired");
	expect(skills.uninstall).not.toHaveBeenCalled();
	expect(installFromMarketSlug).not.toHaveBeenCalled();
	await skillApi.installFromMarket("skill", "review");
	expect(installFromMarketSlug).toHaveBeenCalledWith("skill", "review");

	const api = createOfficialBatchTasksApi(() => {}, "session");
	const data = { name: "Review", prompt: "Review files", folders: ["C:/workspace"], concurrency: 1 };
	await expect(api.createProject({ ...data, skill: { name: "review", type: "scene" } })).rejects.toThrow("retired");
	await expect(api.updateProject("project", { skill: { name: "review", type: "scene" } })).rejects.toThrow("retired");
	expect(batchTasks.createProject).not.toHaveBeenCalled();
	expect(batchTasks.updateProject).not.toHaveBeenCalled();
	await api.createProject({ ...data, skill: { name: "review", type: "skill" } });
	await api.updateProject("project", { skill: null });
	expect(batchTasks.createProject).toHaveBeenCalledWith(
		"session",
		expect.objectContaining({ skill: { name: "review", type: "skill" } }),
	);
	expect(batchTasks.updateProject).toHaveBeenCalledWith("session", "project", { skill: null });
});
