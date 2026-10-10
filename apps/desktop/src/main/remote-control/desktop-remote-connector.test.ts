import { createHash } from "node:crypto";
import { FakeRelay, RemoteConnection } from "@567agent/remote-control";
import { describe, expect, it } from "vitest";
import { DesktopRemoteConnector, type DesktopRemoteOperations } from "./desktop-remote-connector.js";

describe("DesktopRemoteConnector", () => {
	it("blocks a second migration and cancels an archive while desktop approval is pending", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-migration-pending", "mobile"), {
			role: "mobile",
			deviceId: "phone-pending",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-migration-pending", "desktop"), {
			role: "desktop",
			deviceId: "desktop-pending",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
		});
		let resolveApproval!: (accepted: boolean) => void;
		const approval = new Promise<boolean>((resolve) => {
			resolveApproval = resolve;
		});
		let imported = false;
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
			canReceiveSessionMigration: true,
			confirmSessionMigrationArchive: async () => approval,
			receiveEncryptedSessionMigrationArchive: async () => {
				imported = true;
				return {};
			},
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		await mobile.connect();
		await connector.start();
		const bytes = Buffer.from("encrypted archive");
		await mobile.request("session.migration.receive.start", {
			transferId: "migration_pending_1",
			totalBytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		await mobile.request("session.migration.receive.chunk", {
			transferId: "migration_pending_1",
			index: 0,
			dataBase64: bytes.toString("base64"),
		});
		const finish = mobile.request("session.migration.receive.finish", { transferId: "migration_pending_1" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		await expect(
			mobile.request("session.migration.receive.start", {
				transferId: "migration_pending_2",
				totalBytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			}),
		).rejects.toThrow();
		await expect(
			mobile.request("session.migration.receive.cancel", { transferId: "migration_pending_1" }),
		).resolves.toEqual({ cancelled: true });
		resolveApproval(true);
		await expect(finish).resolves.toEqual({ accepted: false, cancelled: true });
		await expect(
			mobile.request("session.migration.receive.import", {
				transferId: "migration_pending_1",
				passphrase: "secure-password",
			}),
		).rejects.toThrow();
		expect(imported).toBe(false);
		await connector.stop();
		await mobile.close();
	});

	it("exposes desktop model selection and preserves the retry target", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-models", "mobile"), {
			role: "mobile",
			deviceId: "phone-models",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-models",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-models", "desktop"), {
			role: "desktop",
			deviceId: "desktop-models",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-models",
		});
		let selectedModel = "provider/model-a";
		let retryArguments: unknown[] = [];
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-models" }),
			openSession: async (sessionId) => ({ sessionId }),
			readModels: () => ({
				currentModelId: selectedModel,
				lastUserMessageId: "user-turn-1",
				models: [{ id: selectedModel }],
			}),
			selectModel: async (_sessionId, modelKey) => {
				selectedModel = modelKey;
			},
			prompt: async function* (...args) {
				retryArguments = args;
				yield { type: "state", payload: { state: "completed" } };
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		await mobile.connect();
		await connector.start();

		await expect(mobile.request("session.create")).resolves.toMatchObject({
			sessionId: "session-models",
			modelCatalog: { currentModelId: "provider/model-a" },
		});
		await mobile.request("session.model.select", { modelKey: "provider/model-b" }, "session-models");
		await mobile.request(
			"session.prompt",
			{
				text: "redo",
				retryPreviousTurn: true,
				retryTargetMessageId: "user-turn-1",
			},
			"session-models",
		);
		await waitFor(() => retryArguments.length > 0);
		expect(selectedModel).toBe("provider/model-b");
		expect(retryArguments).toEqual(["session-models", "redo", true, "user-turn-1", { images: [], refs: [] }]);

		await connector.stop();
		await mobile.close();
	});

	it("maps protocol requests to desktop operations and streams events", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-1", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-1", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-connection",
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [{ id: "session-1", title: "Project" }],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* (_sessionId, text) {
				yield { type: "delta", text: `reply:${text}` };
				yield { type: "state", payload: { state: "completed" } };
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({ state: "online" }),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const events: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.list")).resolves.toEqual({
			sessions: [{ id: "session-1", title: "Project" }],
			supportedMethods: ["session.create"],
		});
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-new",
		});
		await waitFor(() => events.length === 2);
		expect(events).toEqual([{ kind: "delta", text: "reply:hello" }, { state: "completed" }]);

		await connector.stop();
	});

	it("receives a checksummed encrypted archive only when LAN transfer is enabled", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-migration", "mobile"), {
			role: "mobile",
			deviceId: "phone-migration",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-migration",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-migration", "desktop"), {
			role: "desktop",
			deviceId: "desktop-migration",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-migration",
		});
		let imported: { bytes: Buffer; passphrase: string } | undefined;
		let desktopApproved = false;
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
			canReceiveSessionMigration: true,
			confirmSessionMigrationArchive: async () => {
				desktopApproved = true;
				return true;
			},
			receiveEncryptedSessionMigrationArchive: async (bytes, passphrase) => {
				expect(desktopApproved).toBe(true);
				imported = { bytes: Buffer.from(bytes), passphrase };
				return { importedSessions: 1 };
			},
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.list")).resolves.toMatchObject({
			supportedMethods: expect.arrayContaining([
				"session.migration.receive.start",
				"session.migration.receive.chunk",
				"session.migration.receive.finish",
				"session.migration.receive.import",
			]),
		});
		const bytes = Buffer.from("encrypted archive");
		await mobile.request("session.migration.receive.start", {
			transferId: "transfer_migration_1",
			totalBytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		await mobile.request("session.migration.receive.chunk", {
			transferId: "transfer_migration_1",
			index: 0,
			dataBase64: bytes.toString("base64"),
		});
		await expect(
			mobile.request("session.migration.receive.finish", {
				transferId: "transfer_migration_1",
			}),
		).resolves.toEqual({ accepted: true });
		await mobile.request("session.migration.receive.import", {
			transferId: "transfer_migration_1",
			passphrase: "secure-password",
		});
		expect(imported).toEqual({ bytes, passphrase: "secure-password" });
		await connector.stop();
	});

	it("returns the migration import detail instead of a generic remote operation error", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-migration-error", "mobile"), {
			role: "mobile",
			deviceId: "phone-migration-error",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-migration-error", "desktop"), {
			role: "desktop",
			deviceId: "desktop-migration-error",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
			canReceiveSessionMigration: true,
			confirmSessionMigrationArchive: async () => true,
			receiveEncryptedSessionMigrationArchive: async () => {
				throw Object.assign(new Error("message 2 (assistant): invalid record schema"), {
					code: "SESSION_MIGRATION_IMPORT_FAILED",
				});
			},
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		await mobile.connect();
		await connector.start();
		const bytes = Buffer.from("encrypted archive");
		await mobile.request("session.migration.receive.start", {
			transferId: "transfer_migration_error",
			totalBytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		await mobile.request("session.migration.receive.chunk", {
			transferId: "transfer_migration_error",
			index: 0,
			dataBase64: bytes.toString("base64"),
		});
		await mobile.request("session.migration.receive.finish", { transferId: "transfer_migration_error" });

		await expect(
			mobile.request("session.migration.receive.import", {
				transferId: "transfer_migration_error",
				passphrase: "secure-password",
			}),
		).rejects.toMatchObject({
			message: expect.stringContaining("电脑端导入会话备份失败：message 2 (assistant): invalid record schema"),
		});
		await connector.stop();
	});

	it("cancels an in-flight remote suggestion request", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-cancel-suggestions", "mobile"), {
			role: "mobile",
			deviceId: "phone-cancel",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-cancel",
			now: () => 10,
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-cancel-suggestions", "desktop"), {
			role: "desktop",
			deviceId: "desktop-cancel",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-cancel",
		});
		let suggestionSignal: AbortSignal | undefined;
		let suggestionRequestId: string | undefined;
		desktop.onEvent((event) => {
			if (event.type === "remote-request" && event.request.method === "session.suggestions") {
				suggestionRequestId = event.request.requestId;
			}
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-cancel" }),
			openSession: async (sessionId) => ({ sessionId }),
			readSuggestions: async (_sessionId, signal) => {
				suggestionSignal = signal;
				return await new Promise<readonly string[]>((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
			prompt: async function* () {},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.list")).resolves.toMatchObject({
			supportedMethods: ["session.create", "session.suggestions", "session.suggestions.cancel"],
		});

		const suggestions = mobile.request("session.suggestions", undefined, "session-cancel");
		await waitFor(() => suggestionSignal !== undefined && suggestionRequestId !== undefined);
		await mobile.request("session.suggestions.cancel", { requestId: suggestionRequestId }, "another-session");
		expect(suggestionSignal?.aborted).toBe(false);
		await mobile.request("session.suggestions.cancel", { requestId: suggestionRequestId }, "session-cancel");
		await waitFor(() => suggestionSignal?.aborted === true);

		await mobile.close();
		await expect(suggestions).rejects.toThrow();
		await connector.stop();
	});

	it("maps provider authentication failures without exposing provider messages", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-auth", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-auth-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-auth", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-auth-connection",
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {
				yield { type: "state", payload: { state: "running" } };
				throw Object.assign(new Error("invalid key suffix: sensitive"), {
					code: "TURN_FAILED",
					details: {
						code: "AI_AUTHENTICATION_FAILED",
						retryable: false,
						origin: "provider",
					},
				});
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const errors: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event" && event.event.name === "session.state") errors.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-new",
		});
		await waitFor(() => errors.some((value) => (value as { state?: string }).state === "error"));
		expect(errors.at(-1)).toEqual({
			state: "error",
			code: "unauthorized",
			message: "电脑端模型认证失败，请检查默认模型和 API 密钥",
		});

		await connector.stop();
		await mobile.close();
	});

	it("keeps a remote turn alive while waiting for a user answer", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-question", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-question-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-question", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-question-connection",
		});
		let releaseQuestion: (() => void) | undefined;
		let receivedAnswer: unknown;
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-question" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {
				yield {
					type: "input",
					payload: {
						kind: "question",
						requestId: "question-1",
						questions: [{ question: "继续吗？", header: "确认", options: [{ label: "继续", description: "" }] }],
					},
				};
				await new Promise<void>((resolve) => {
					releaseQuestion = resolve;
				});
				yield {
					type: "delta",
					text: `continued:${String((receivedAnswer as { answers?: unknown[] })?.answers?.length ?? 0)}`,
				};
				yield { type: "state", payload: { state: "completed" } };
			},
			abort: async () => undefined,
			respond: async (_sessionId, _requestId, result) => {
				receivedAnswer = result;
				releaseQuestion?.();
			},
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const events: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-question",
		});
		await waitFor(() => events.some((value) => (value as { kind?: string }).kind === "question"));
		await expect(
			mobile.request(
				"session.respond",
				{
					requestId: "question-1",
					cancelled: false,
					answers: [{ question: "继续吗？", answers: ["继续"] }],
				},
				"session-question",
			),
		).resolves.toEqual({ responded: true });
		await waitFor(
			() =>
				events.includes({ kind: "delta", text: "continued:1" }) ||
				events.some((value) => (value as { text?: string }).text === "continued:1"),
		);
		expect(receivedAnswer).toMatchObject({
			cancelled: false,
			answers: [{ question: "继续吗？", answers: ["继续"] }],
		});

		await connector.stop();
		await mobile.close();
	});
});

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition was not met");
}
