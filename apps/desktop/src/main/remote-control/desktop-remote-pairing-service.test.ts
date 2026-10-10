import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: {} as Record<string, unknown>,
	readDesktopConfig: vi.fn(),
	updateDesktopConfig: vi.fn(),
	localRelay: undefined as unknown,
	startDesktopRemoteAccess: vi.fn(),
	startDesktopRemoteDesktopHost: vi.fn(),
	createDesktopRemoteCertificate: vi.fn(),
}));

vi.mock("../config/desktop-config-store.js", () => ({
	readDesktopConfig: mocks.readDesktopConfig,
	updateDesktopConfig: mocks.updateDesktopConfig,
}));
vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: vi.fn() }));
vi.mock("./desktop-local-relay.js", () => ({ getDesktopLocalRelay: () => mocks.localRelay }));
vi.mock("./desktop-local-relay-certificate.js", () => ({
	createDesktopLocalRelayCertificate: mocks.createDesktopRemoteCertificate,
	isDesktopLocalRelayCertificateAuthority: (certificate: string) => certificate === "local-cert",
}));
vi.mock("./desktop-remote-access-service.js", () => ({
	startDesktopRemoteAccess: mocks.startDesktopRemoteAccess,
	stopDesktopRemoteAccess: vi.fn(),
}));
vi.mock("./desktop-remote-desktop-host.js", () => ({
	startDesktopRemoteDesktopHost: mocks.startDesktopRemoteDesktopHost,
	stopDesktopRemoteDesktopHost: vi.fn(),
}));

describe("DesktopRemotePairingService.restore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.localRelay = undefined;
		mocks.config = {
			remoteControl: { pairingId: "pairing", relayBaseUrl: "wss://relay.example", inputEnabled: true },
		};
		mocks.readDesktopConfig.mockImplementation(async () => mocks.config);
		mocks.updateDesktopConfig.mockImplementation(
			async (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
				mocks.config = updater(mocks.config);
				return mocks.config;
			},
		);
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
		expect(service.getState()).toMatchObject({
			status: "error",
			inputPermissionEnabled: true,
			inputEnabled: false,
			inputSupported: false,
		});
		expect(service.getState().error).toContain("create a new pairing");
		expect(vault.remove).not.toHaveBeenCalled();
		expect(vault.put).not.toHaveBeenCalled();
	});

	it("connects to both cloud and certificate-pinned LAN relay routes", async () => {
		const { DesktopRemotePairingService } = await import("./desktop-remote-pairing-service.js");
		mocks.localRelay = {
			getLanIp: () => "192.168.1.20",
			getLanUrl: () => "https://192.168.1.20:18789",
			start: vi.fn(),
			stop: vi.fn(),
		};
		mocks.createDesktopRemoteCertificate.mockResolvedValue({
			certificate: "local-cert",
			privateKey: "local-key",
			fingerprint: "a".repeat(64),
		});
		mocks.startDesktopRemoteDesktopHost.mockResolvedValue({
			inputSupported: false,
			inputSupportReason: "x11_display_unavailable",
		});
		const service = new DesktopRemotePairingService(
			{
				appRoot: "/app",
				isPackaged: true,
				conversationCwd: "/conversation",
				defaultRelayBaseUrl: "https://relay.example",
			},
			{ isAvailable: () => true, get: () => undefined, put: vi.fn(), remove: vi.fn() },
		);

		await service.create();
		expect(service.getState()).toMatchObject({
			inputSupported: false,
			inputSupportReason: "x11_display_unavailable",
		});

		const accessOptions = mocks.startDesktopRemoteAccess.mock.calls[0]?.[0];
		expect(accessOptions.controlTargets).toHaveLength(2);
		expect(accessOptions.controlTargets[0].target).toContain("wss://relay.example/v1/relay/");
		expect(accessOptions.controlTargets[1].target).toContain("wss://192.168.1.20:18789/v1/relay/");
		expect(accessOptions.controlTargets[1].webSocketCaCertificate).toBe("local-cert");
		const hostOptions = mocks.startDesktopRemoteDesktopHost.mock.calls[0]?.[0];
		expect(hostOptions.signalingTargets).toHaveLength(2);
		expect(hostOptions.signalingTargets[0]).toContain("wss://relay.example/v1/desktop/");
		expect(hostOptions.signalingTargets[1]).toContain("fingerprint=");
	});

	it("persists a newly created pairing so a new service can restore it", async () => {
		const { DesktopRemotePairingService } = await import("./desktop-remote-pairing-service.js");
		mocks.localRelay = {
			getLanIp: () => "192.168.1.20",
			getLanUrl: () => "https://192.168.1.20:18789",
			start: vi.fn(),
			stop: vi.fn(),
		};
		mocks.createDesktopRemoteCertificate.mockResolvedValue({
			certificate: "local-cert",
			privateKey: "local-key",
			fingerprint: "a".repeat(64),
		});
		mocks.startDesktopRemoteDesktopHost.mockResolvedValue({ inputSupported: false });
		const storedCredentials = new Map<string, string>();
		const vault = {
			isAvailable: () => true,
			get: vi.fn((ref: { name: string }) => storedCredentials.get(ref.name)),
			put: vi.fn((ref: { name: string }, value: string) => storedCredentials.set(ref.name, value)),
			remove: vi.fn((ref: { name: string }) => storedCredentials.delete(ref.name)),
		};
		const options = {
			appRoot: "/app",
			isPackaged: true,
			conversationCwd: "/conversation",
			defaultRelayBaseUrl: "https://relay.example",
		};
		const creator = new DesktopRemotePairingService(options, vault);
		const created = await creator.create();

		expect(await mocks.readDesktopConfig()).toMatchObject({
			remoteControl: {
				pairingId: created.pairingId,
				relayBaseUrl: "https://relay.example",
				inputEnabled: false,
			},
		});

		mocks.startDesktopRemoteDesktopHost.mockResolvedValue({ inputSupported: false });
		const restored = new DesktopRemotePairingService(options, vault);
		await restored.restore();
		expect(restored.getState()).toMatchObject({ status: "ready", pairingId: created.pairingId });
	});
});
