// @vitest-environment jsdom
import { i18n, initI18n } from "@shared/i18n";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
	default: { toString: async () => { throw new Error("svg generation failed"); } },
}));

import { RemotePairingSettings } from "./RemotePairingSettings";

afterEach(() => {
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
