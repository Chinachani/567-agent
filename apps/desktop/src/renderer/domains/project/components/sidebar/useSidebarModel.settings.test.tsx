// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { initI18n } from "@shared/i18n";
import { useSidebarModel } from "./useSidebarModel";
import { SIDEBAR_NAV_LAYOUT_STORAGE_KEY } from "./sidebar-nav-layout";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate, useMatches: () => [{ pathname: "/" }] }));
vi.mock("../../hooks/useNewChatNavigation", () => ({ useNewChatNavigation: () => vi.fn() }));
it("reconciles saved settings shortcuts out of both navigation regions while preserving workspace actions", () => {
	initI18n();
	localStorage.setItem(
		SIDEBAR_NAV_LAYOUT_STORAGE_KEY,
		JSON.stringify({
			version: 2,
			pinned: ["/settings/models", "/abilities"],
			more: ["/settings/context", "/settings/appearance", "/settings/extensions", "/automation"],
		}),
	);
	const store = createStore();
	const { result } = renderHook(() => useSidebarModel({ onCollapse: vi.fn() }), {
		wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
	});
	const items = [...result.current.navItems, ...result.current.moreNavItems];
	expect(items.some((item) => item.key.startsWith("/settings/"))).toBe(false);
	expect(items.map((item) => item.key)).toEqual(expect.arrayContaining(["new-session", "/abilities", "/automation"]));
});

it("exposes knowledge and automation by default while keeping an explicitly customized pinned region", () => {
	initI18n();
	localStorage.removeItem(SIDEBAR_NAV_LAYOUT_STORAGE_KEY);
	const firstStore = createStore();
	const first = renderHook(() => useSidebarModel({ onCollapse: vi.fn() }), {
		wrapper: ({ children }: { children: ReactNode }) => <Provider store={firstStore}>{children}</Provider>,
	});
	expect(first.result.current.navItems.map((item) => item.key)).toEqual(
		expect.arrayContaining(["/knowledge", "/automation"]),
	);
	first.unmount();
	localStorage.setItem(
		SIDEBAR_NAV_LAYOUT_STORAGE_KEY,
		JSON.stringify({ version: 2, pinned: ["/abilities"], more: ["/knowledge", "/automation", "/agents"] }),
	);
	const store = createStore();
	const customized = renderHook(() => useSidebarModel({ onCollapse: vi.fn() }), {
		wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
	});
	expect(customized.result.current.navItems.map((item) => item.key)).toEqual(["new-session", "/abilities"]);
	expect(customized.result.current.moreNavItems.map((item) => item.key)).toEqual(
		expect.arrayContaining(["/knowledge", "/automation"]),
	);
	customized.unmount();
	localStorage.removeItem(SIDEBAR_NAV_LAYOUT_STORAGE_KEY);
});
