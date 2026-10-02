import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readDesktopConfig: vi.fn() }));

vi.mock("../config/desktop-config-store.js", () => ({
	readDesktopConfig: mocks.readDesktopConfig,
	updateDesktopConfig: vi.fn(),
}));
vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: vi.fn() }));
vi.mock("./desktop-local-relay.js", () => ({ getDesktopLocalRelay: vi.fn() }));
vi.mock("./desktop-local-relay-certificate.js", () => ({ createDesktopLocalRelayCertificate: vi.fn() }));
vi.mock("./desktop-remote-access-service.js", () => ({
	startDesktopRemoteAccess: vi.fn(),
	stopDesktopRemoteAccess: vi.fn(),
}));
vi.mock("./desktop-remote-desktop-host.js", () => ({
	startDesktopRemoteDesktopHost: vi.fn(),
	stopDesktopRemoteDesktopHost: vi.fn(),
}));

describe("DesktopRemotePairingService.restore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readDesktopConfig.mockResolvedValue({
			remoteControl: { pairingId: "pairing", relayBaseUrl: "wss://relay.example", inputEnabled: true },
		});
	});

	it("reports undecryptable saved credentials without an unhandled rejection or deleting them", async () => {
		const { DesktopRemotePairingService } = await import("./desktop-remote-pairing-service.js");
		const vault = {
			isAvailable: vi.fn(() => true),
			get: vi.fn(() => {
				throw new Error("safeStorage decrypt failed");
			}),
			put: vi.fn(),
			remove: vi.fn(),
		};
		const service = new DesktopRemotePairingService(
			{ appRoot: "/app", isPackaged: true, conversationCwd: "/conversation" },
			vault,
		);

		await expect(service.restore()).resolves.toBeUndefined();
		expect(service.getState()).toMatchObject({ status: "error", inputEnabled: true, inputSupported: false });
		expect(service.getState().error).toContain("create a new pairing");
		expect(vault.remove).not.toHaveBeenCalled();
		expect(vault.put).not.toHaveBeenCalled();
	});
});
