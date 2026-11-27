import { describe, expect, it } from "vitest";
import { openCanvasAfterWarmup } from "../src/vetd/auto-open";
import { pickDesignPaths } from "../src/vetd/discover";

function ref(relPath: string): { name: string; path: string; relPath: string } {
	const name = relPath.split("/").pop() ?? relPath;
	return { name, path: `/proj/${relPath}`, relPath };
}

describe("pickDesignPaths", () => {
	it("按 design.json 反推设计包目录并排序", () => {
		expect(
			pickDesignPaths([
				ref("b.vetd/design.json"),
				ref("a.vetd/design.json"),
				ref("a.vetd/frames/home.tsx"),
				ref("x.ts"),
			]).bundles,
		).toEqual(["/proj/a.vetd", "/proj/b.vetd"]);
	});

	it("旧格式文件单独归类，包内部的同名文件不算设计", () => {
		const picked = pickDesignPaths([
			ref("legacy.vetd"),
			ref("legacy.vetd.d/frames/home.tsx"),
			ref("a.vetd/design.json"),
			ref("a.vetd/assets/inner.vetd"),
		]);
		expect(picked.bundles).toEqual(["/proj/a.vetd"]);
		expect(picked.legacyFiles).toEqual(["/proj/legacy.vetd"]);
	});
});

describe("openCanvasAfterWarmup", () => {
	it("画布代码取回后才打开面板，打开动画不再和 chunk 求值抢主线程", async () => {
		const order: string[] = [];
		let release: () => void = () => undefined;
		const warm = () =>
			new Promise<void>((resolve) => {
				release = () => {
					order.push("warm");
					resolve();
				};
			});
		const done = openCanvasAfterWarmup(warm, () => false, () => order.push("open"));
		expect(order).toEqual([]);
		release();
		await done;
		expect(order).toEqual(["warm", "open"]);
	});

	it("预热失败照样打开面板", async () => {
		let opened = false;
		await openCanvasAfterWarmup(
			() => Promise.reject(new Error("offline")),
			() => false,
			() => {
				opened = true;
			},
		);
		expect(opened).toBe(true);
	});

	it("预热期间会话已切走则不打开", async () => {
		let opened = false;
		await openCanvasAfterWarmup(
			() => Promise.resolve(),
			() => true,
			() => {
				opened = true;
			},
		);
		expect(opened).toBe(false);
	});
});
