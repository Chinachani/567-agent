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
