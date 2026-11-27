import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊 Hero：门面同时是两条主入口。这里钉住的是它的行为契约——
 * 数字只反映真实存在的东西（空库不吹「0 个项目」）、两个按钮各自回调、busy 时不可点。
 */

vi.mock("@vetta-org/plugin-sdk", () => {
	const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key);
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryHero } from "../src/gallery/GalleryHero";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function mount(props: Partial<React.ComponentProps<typeof GalleryHero>> = {}) {
	const onCreate = vi.fn();
	const onBrowseStyles = vi.fn();
	const onRefresh = vi.fn();
	const onImport = vi.fn();
	act(() => {
		root.render(
			<GalleryHero
				projectCount={4}
				designCount={9}
				empty={false}
				loading={false}
				busy={false}
				onRefresh={onRefresh}
				onImport={onImport}
				onCreate={onCreate}
				onBrowseStyles={onBrowseStyles}
				{...props}
			/>,
		);
	});
	return { onCreate, onBrowseStyles, onRefresh, onImport };
}

function buttonWith(text: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
}

describe("画廊 Hero", () => {
	it("有内容时显示项目与设计数", () => {
		mount();
		const stats = host.querySelectorAll("li");
		expect([...stats].map((item) => item.textContent)).toEqual([
			'gallery.hero.stat.projects|{"count":4}',
			'gallery.hero.stat.designs|{"count":9}',
		]);
	});

	it("空库时隐藏统计并换成引导性副标题", () => {
		mount({ empty: true, projectCount: 0, designCount: 0 });
		expect(host.querySelectorAll("li")).toHaveLength(0);
		expect(host.textContent).toContain("gallery.hero.subtitle.empty");
		expect(host.textContent).not.toContain("gallery.hero.subtitle|");
	});

	it("Hero 的刷新与导入按钮各自回调", () => {
		const { onRefresh, onImport } = mount();
		act(() => host.querySelector<HTMLButtonElement>('[aria-label="gallery.action.refresh"]')?.click());
		expect(onRefresh).toHaveBeenCalledOnce();

		act(() => buttonWith("gallery.action.import")?.click());
		expect(onImport).toHaveBeenCalledOnce();
	});

	it("刷新中不可重复点，按钮进入 loading 态", () => {
		const { onRefresh } = mount({ loading: true });
		const refresh = host.querySelector<HTMLButtonElement>('[aria-label="gallery.action.refresh"]');
		expect(refresh?.disabled).toBe(true);
		act(() => refresh?.click());
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it("两个按钮各自回调，busy 时新建不可点", () => {
		const { onCreate, onBrowseStyles } = mount();
		act(() => buttonWith("gallery.hero.create")?.click());
		act(() => buttonWith("gallery.hero.browseStyles")?.click());
		expect(onCreate).toHaveBeenCalledOnce();
		expect(onBrowseStyles).toHaveBeenCalledOnce();

		const busy = mount({ busy: true });
		expect(buttonWith("gallery.hero.create")?.disabled).toBe(true);
		act(() => buttonWith("gallery.hero.create")?.click());
		expect(busy.onCreate).not.toHaveBeenCalled();
	});
});
