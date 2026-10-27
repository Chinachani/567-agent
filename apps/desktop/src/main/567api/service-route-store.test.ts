import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBuiltinApi567Route } from "../../shared/service-routes.js";
import { Api567RouteStore } from "./service-route-store.js";

const roots: string[] = [];
function home() {
	const root = mkdtempSync(join(tmpdir(), "567-routes-"));
	roots.push(root);
	return root;
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop service route migration", () => {
	it("defaults a new installation to Germany and preserves an explicit mainland selection on restart", async () => {
		const root = home();
		const routes = new Api567RouteStore(root);
		expect(routes.route).toBe("germany");
		await routes.initialize();
		await routes.select("mainland");
		expect(new Api567RouteStore(root).route).toBe("mainland");
		await routes.select("germany");
		expect(new Api567RouteStore(root).route).toBe("germany");
		expect(JSON.parse(readFileSync(join(root, "service-route.json"), "utf8"))).toMatchObject({
			schemaVersion: 1,
			route: "germany",
		});
	});
	it("migrates the old persisted default, then preserves a user's mainland choice across restarts", async () => {
		const root = home();
		const path = join(root, "service-route.json");
		writeFileSync(path, JSON.stringify({ schemaVersion: 1, route: "mainland" }));
		const upgraded = new Api567RouteStore(root);
		expect(upgraded.route).toBe("germany");
		await upgraded.initialize();
		expect(JSON.parse(readFileSync(path, "utf8")).route).toBe("germany");
		await upgraded.select("mainland");
		const restarted = new Api567RouteStore(root);
		await restarted.initialize();
		expect(restarted.route).toBe("mainland");
		expect(new Api567RouteStore(root).route).toBe("mainland");
	});
	it.each([
		{ knownOrigins: [] },
		{ knownOrigins: ["https://a.567.wiki"] },
		{ knownOrigins: ["https://node.example"] },
	])("preserves a mainland record with an existing choice marker: %j", async ({ knownOrigins }) => {
		const root = home();
		writeFileSync(
			join(root, "service-route.json"),
			JSON.stringify({ schemaVersion: 1, route: "mainland", knownOrigins }),
		);
		await new Api567RouteStore(root).initialize();
		expect(new Api567RouteStore(root).route).toBe("mainland");
	});

	it.each(["567api-session.json", "agent/models.json", "agent/settings.json"])(
		"preserves the implicit German route for an upgrade with %s",
		async (path) => {
			const root = home();
			mkdirSync(join(root, "agent"));
			writeFileSync(join(root, path), "{}");
			const routes = new Api567RouteStore(root);
			await routes.initialize();
			expect(routes.route).toBe("germany");
			expect(new Api567RouteStore(root).route).toBe("germany");
		},
	);
	it("discovers another node, selects it, and restores it even after removal from the catalog and cache cleanup", async () => {
		const root = home();
		const routes = new Api567RouteStore(root);
		const node = { id: "https://node3.567.wiki" as const, origin: "https://node3.567.wiki", name: "线路三" };
		await routes.saveCatalog([node]);
		expect(routes.catalog.routes).toContainEqual(node);
		expect(routes.route).toBe("germany");
		await routes.select(node.id);
		await routes.saveCatalog([{ id: "germany", origin: "https://api.567.wiki" }]);
		expect(routes.catalog.routes.map((route) => route.id)).toContain(node.id);
		rmSync(join(root, "cache"), { recursive: true });
		const restored = new Api567RouteStore(root);
		expect(restored.origin).toBe(node.origin);
		expect(restored.trustedOrigins).toContain(node.origin);
		await restored.select("germany");
		expect(restored.trustedOrigins).toContain(node.origin);
		await expect(restored.select("https://unknown.567.wiki")).rejects.toThrow("discovered catalog");
	});
	it("blocks a damaged or future configuration until explicit repair preserves the original", async () => {
		const root = home();
		const path = join(root, "service-route.json");
		writeFileSync(path, '{"schemaVersion":2,"route":"germany"}');
		const store = new Api567RouteStore(root);
		expect(store.selectedRoute).toBeUndefined();
		expect(() => store.origin).toThrow();
		expect(store.catalog.routes.length).toBeGreaterThan(0);
		await expect(store.initialize()).rejects.toThrow();
		expect(readFileSync(path, "utf8")).toContain('"schemaVersion":2');
		await store.select("germany");
		expect(new Api567RouteStore(root).origin).toBe("https://api.567.wiki");
		const backup = readdirSync(root).find((name) => name.startsWith("service-route.invalid-"))!;
		expect(readFileSync(join(root, backup), "utf8")).toContain('"schemaVersion":2');
	});
	it.each([
		"https://api.567.wiki.evil/v1",
		"https://other.test/v1",
		"http://api.567.wiki/v1",
		"https://user@api.567.wiki/v1",
		"https://api.567.wiki/v1?token=x",
		"https://api.567.wiki/custom",
		"https://api.567.wiki:444/v1",
	])("keeps custom addresses separate: %s", (value) => expect(getBuiltinApi567Route(value)).toBeUndefined());
});
