import { describe, expect, it } from "vitest";
import { getBuiltinApi567Route, parseApi567RouteList } from "./service-routes.js";

describe("public New API route list", () => {
	it("normalizes API paths, keeps configured labels, deduplicates and trusts exact discovered origins", () => {
		const routes = parseApi567RouteList([
			{ id: 2, url: "https://a.567.wiki/v1/", route: "大陆", description: "北京" },
			{ url: "https://node3.567.wiki", route: "香港" },
			{ url: "https://node3.567.wiki/v1" },
		]);
		expect(routes).toEqual([
			{ id: "mainland", origin: "https://a.567.wiki", name: "大陆", description: "北京" },
			{ id: "https://node3.567.wiki", origin: "https://node3.567.wiki", name: "香港" },
		]);
		expect(getBuiltinApi567Route("https://node3.567.wiki/v1")).toBeUndefined();
		expect(
			getBuiltinApi567Route(
				"https://node3.567.wiki/v1",
				routes.map((route) => route.origin),
			),
		).toBe("https://node3.567.wiki");
		expect(
			getBuiltinApi567Route(
				"https://node3.567.wiki.evil/v1",
				routes.map((route) => route.origin),
			),
		).toBeUndefined();
	});
	it.each([
		[],
		{},
		null,
		[{ url: "http://a.567.wiki" }],
		[{ url: "https://user:pass@a.567.wiki" }],
		[{ url: "https://a.567.wiki?key=x" }],
		[{ url: "https://127.0.0.1" }],
		[{ url: "https://service.local" }],
		[{ url: "https://a.567.wiki/admin" }],
		Array(51).fill({ url: "https://a.567.wiki" }),
	])("rejects empty, malformed and unsafe lists: %j", (value) => {
		expect(() => parseApi567RouteList(value)).toThrow();
	});
});
