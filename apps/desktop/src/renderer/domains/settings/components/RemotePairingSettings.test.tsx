// @vitest-environment jsdom
import { i18n, initI18n } from "@shared/i18n";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
	default: { toString: async () => { throw new Error("svg generation failed"); } },
}));

import { RemotePairingSettings } from "./RemotePairingSettings";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("shows why remote input is unavailable and reports QR rendering errors", async () => {
	initI18n();
	await i18n.changeLanguage("en");
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			remotePairing: {
				getState: async () => ({
					status: "ready",
					inviteUri: "agent567://pair?token=test",
					inputEnabled: false,
					inputSupported: false,
					inputSupportReason: "x11_display_unavailable",
				}),
				create: async () => { throw new Error("unused"); },
				setInputEnabled: async () => { throw new Error("unused"); },
				revoke: async () => ({ status: "idle", inputEnabled: false, inputSupported: false }),
			},
		},
	});

	render(<RemotePairingSettings />);

	expect(await screen.findByText(/Linux remote input requires an X11 or XWayland session/)).toBeTruthy();
	expect((await screen.findByRole("alert")).textContent).toContain("Couldn't generate the QR code");
});

it("Wayland input shows a pending system grant and recovers from cancellation without marking the connection failed", async () => {
    initI18n(); await i18n.changeLanguage("en");
    let deny!: (error: Error) => void;
    const status = { status: "connected", autoShareScreen: true, inputEnabled: false, inputSupported: true, inputPointerMode: "relative", pairingId: "paired", relayBaseUrl: "https://example.invalid" };
    Object.defineProperty(window, "vetta", { configurable: true, value: { remotePairing: {
        getState: async () => status,
        setInputEnabled: vi.fn(() => new Promise((_resolve, reject) => { deny = reject; })),
    } } });
    const user = userEvent.setup(); render(<RemotePairingSettings />);
    const input = await screen.findByRole("switch", { name: "Allow remote input" });
    await user.click(input);
    expect((input as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Confirm remote input permission/)).toBeTruthy();
    await act(async () => deny(new Error("cancelled")));
    expect((input as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Screen viewing remains available");
});
