// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuideBadgeSwiperView } from "@vetta-org/theme-ui/chat";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);

it("lets keyboard users open or dismiss a hint independently without navigating on dismissal", async () => {
	const user = userEvent.setup();
	const onOpen = vi.fn();
	const onDismiss = vi.fn();
	const props = {
		mounted: true,
		current: {
			id: "browser-guide",
			icon: "icon-[solar--global-linear]",
			text: "Connect your browser",
			dismissible: true,
			onClick: onOpen,
		},
		labels: { dismissTooltip: "Dismiss hint" },
		onDismiss,
	};
	const view = render(<GuideBadgeSwiperView {...props} />);
	await user.tab();
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Connect your browser" }));
	await user.keyboard("{Enter}");
	expect(onOpen).toHaveBeenCalledOnce();
	await user.tab();
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss hint" }));
	await user.keyboard("{Enter}");
	expect(onDismiss).toHaveBeenCalledWith("browser-guide");
	expect(onOpen).toHaveBeenCalledOnce();
	view.rerender(<GuideBadgeSwiperView {...props} current={{ ...props.current, dismissible: false }} />);
	expect(screen.queryByRole("button", { name: "Dismiss hint" })).toBeNull();
	expect(screen.getByRole("button", { name: "Connect your browser" })).toBeTruthy();
});
