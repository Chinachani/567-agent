import { hostname } from "node:os";
import type { RemoteConnectionState } from "@567agent/remote-control";
import { RemoteConnection, RemoteEventJournal, WebSocketRemoteTransport } from "@567agent/remote-control";
import { app } from "electron";
import { readAbilityLedger } from "../abilities/ability-ledger.js";
import { getOpenMarketplaceManager } from "../abilities/open-marketplace/open-marketplace-manager.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { resolveDesktopRuntimeSessionRoots } from "../conversations/session-catalog-roots.js";
import { visibleConversation } from "../conversations/visible-conversation.js";
import { getAppLogger } from "../logger.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import { readPluginBlobRange } from "../plugins/plugin-storage-service.js";
import {
	DesktopConversationRemoteOperations,
	DesktopRemoteConversationState,
} from "./desktop-conversation-remote-operations.js";
import { DesktopRemoteConnector } from "./desktop-remote-connector.js";
import { createDesktopRemoteFiles } from "./desktop-remote-files.js";
import { createDesktopWebSocketFactory } from "./desktop-websocket.js";
import { RemotePromptRecovery } from "./remote-prompt-recovery.js";

export interface DesktopRemoteAccessOptions {
	readonly controlUrl?: string;
	readonly pairingToken?: string;
	readonly pairingId?: string;
	readonly controlTarget?: string;
	readonly webSocketCaCertificate?: string;
	readonly controlTargets?: readonly {
		readonly target: string;
		readonly webSocketCaCertificate?: string;
		readonly allowSessionMigrationTransfer?: boolean;
	}[];
	readonly conversationCwd: string;
	readonly onStateChange?: (state: RemoteConnectionState) => void;
}

interface ActiveConnector {
	readonly connector: DesktopRemoteConnector;
	readonly unsubscribe: () => void;
	readonly options: DesktopRemoteAccessOptions & {
		readonly target: string;
		readonly webSocketCaCertificate?: string;
		readonly allowSessionMigrationTransfer?: boolean;
	};
	reconnectTimer?: ReturnType<typeof setTimeout>;
	reconnectPending: boolean;
	reconnectDelayMs: number;
}

const log = getAppLogger("remote-access");
const active = new Map<string, ActiveConnector>();
const targetStates = new Map<string, RemoteConnectionState>();
/**
 * One publisher and replay window per paired target. The connector itself is
 * replaced after a socket failure, so keeping this here is what lets a new
 * transport replay unacknowledged session events.
 */
const eventJournals = new Map<string, RemoteEventJournal>();
let generation = 0;
let conversationState = new DesktopRemoteConversationState();
let promptRecovery = new RemotePromptRecovery();

export async function startDesktopRemoteAccess(options: DesktopRemoteAccessOptions): Promise<void> {
	if (active.size > 0) return;
	const runGeneration = ++generation;
	conversationState = new DesktopRemoteConversationState();
	promptRecovery = new RemotePromptRecovery();
	const targets = options.controlTargets ?? [
		{
			target: options.controlTarget ?? `${options.controlUrl}#${options.pairingToken}`,
			webSocketCaCertificate: options.webSocketCaCertificate,
		},
	];
	await Promise.all(targets.map((target, index) => connect(options, target, `target-${index}`, runGeneration)));
}

export async function stopDesktopRemoteAccess(): Promise<void> {
	generation += 1;
	const current = [...active.values()];
	active.clear();
	targetStates.clear();
	eventJournals.clear();
	promptRecovery.clear();
	for (const entry of current) {
		if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
		entry.unsubscribe();
	}
	await Promise.all(current.map((entry) => entry.connector.stop()));
	log.info("remote access connector stopped");
}

async function connect(
	baseOptions: DesktopRemoteAccessOptions,
	target: {
		readonly target: string;
		readonly webSocketCaCertificate?: string;
		readonly allowSessionMigrationTransfer?: boolean;
	},
	key: string,
	runGeneration: number,
	reconnectDelayMs = 1_000,
): Promise<void> {
	if (runGeneration !== generation) return;
	const options = { ...baseOptions, ...target };
	const deviceId = `desktop-${hostname()
		.replace(/[^A-Za-z0-9_-]/g, "-")
		.slice(0, 64)}`;
	const connection = new RemoteConnection(
		new WebSocketRemoteTransport(options.target, createDesktopWebSocketFactory(options.webSocketCaCertificate)),
		{
			role: "desktop",
			deviceId,
			deviceName: hostname(),
			capabilities: { chat: true, sessionRead: true, fileRead: true },
			logger: {
				debug: (message: string, metadata) => log.debug(message, metadata),
				info: (message: string, metadata) => log.info(message, metadata),
				warn: (message: string, metadata) => log.warn(message, metadata),
			},
			eventJournal: getEventJournal(key),
		},
	);
	const operations = new DesktopConversationRemoteOperations(
		getDesktopConversationService(),
		{
			pairingId: options.pairingId,
			canAppendDraft: true,
			cwd: options.conversationCwd,
			files: createDesktopRemoteFiles(),
			resolveSessionRoots: resolveDesktopRuntimeSessionRoots,
			readDefaultModelKey: async () => (await getDesktopModelSettingsService().getConfig()).defaultModel,
			readGeneratedImageChunk: (id, offset, length) => readPluginBlobRange("image-gen", id, offset, length),
			readToolbox: async () => {
				const catalog = await getOpenMarketplaceManager(app.getVersion()).list();
				const ledger = readAbilityLedger();
				const listed = catalog.abilities.slice(0, 300).map((ability) => ({
					slug: ability.slug,
					type: ability.type,
					name: ability.name,
					description: ability.description.slice(0, 600),
					version: ability.version,
					author: ability.author,
					category: ability.category,
					tags: ability.tags.slice(0, 12),
					installable: ability.installable !== false && ["skill", "plugin"].includes(ability.type),
					installed: Boolean(ledger[`${ability.type}:${ability.slug}`]),
				}));
				const listedKeys = new Set(listed.map((ability) => `${ability.type}:${ability.slug}`));
				const installedLocal = Object.entries(ledger).flatMap(([key, entry]) => {
					const separator = key.indexOf(":");
					if (separator <= 0) return [];
					const type = key.slice(0, separator);
					const slug = key.slice(separator + 1);
					if (listedKeys.has(key) || !["skill", "plugin", "mcp"].includes(type)) return [];
					return [
						{
							slug,
							type: type as "skill" | "mcp" | "plugin",
							name: slug,
							description: "已安装在这台电脑上；详细配置请在桌面端管理。",
							version: entry.version,
							author: "",
							category: "已安装",
							tags: [],
							installable: false,
							installed: true,
						},
					];
				});
				return [...listed, ...installedLocal].slice(0, 400);
			},
			installToolbox: (type, slug) => {
				if (type === "scene") throw new Error("Scenes have been retired.");
				return getOpenMarketplaceManager(app.getVersion()).install(type, slug);
			},
			allowSessionMigrationTransfer: options.allowSessionMigrationTransfer === true,
			readDeviceStatus: () => ({ activeConversation: visibleConversation.snapshot() }),
		},
		conversationState,
	);
	const connector = new DesktopRemoteConnector(connection, operations, promptRecovery);
	let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
	const detach = connection.onEvent((event) => {
		if (event.type === "state") {
			if (recoveryTimer) clearTimeout(recoveryTimer);
			recoveryTimer = undefined;
			if (event.state === "recovering") {
				// No further frame is guaranteed after a missing event. Recover this control route
				// through its existing reconnect policy without resubmitting any user operation.
				recoveryTimer = setTimeout(() => {
					if (
						runGeneration === generation &&
						active.get(key)?.connector === connector &&
						connection.getSnapshot().state === "recovering"
					)
						void scheduleReconnect(key, runGeneration);
				}, 8_000);
			}
			targetStates.set(key, event.state);
			options.onStateChange?.(aggregateState());
		}
		if (event.type === "state" && event.state === "online") {
			const current = active.get(key);
			if (current) current.reconnectDelayMs = 1_000;
		}
		if (event.type === "state" && (event.state === "reconnecting" || event.state === "failed")) {
			void scheduleReconnect(key, runGeneration);
		}
	});
	const entry: ActiveConnector = {
		connector,
		unsubscribe: () => {
			detach();
			clearTimeout(recoveryTimer);
		},
		options,
		reconnectPending: false,
		reconnectDelayMs,
	};
	active.set(key, entry);
	try {
		await connector.start();
		log.info("remote access connector started", { deviceId });
	} catch (error) {
		log.warn("remote access connection attempt failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		if (active.get(key) === entry) await scheduleReconnect(key, runGeneration);
	}
}

function getEventJournal(key: string): RemoteEventJournal {
	let journal = eventJournals.get(key);
	if (!journal) {
		const host =
			hostname()
				.replace(/[^A-Za-z0-9_-]/g, "-")
				.slice(0, 48) || "desktop";
		journal = new RemoteEventJournal(`desktop-${host}-${key}`);
		eventJournals.set(key, journal);
	}
	return journal;
}

async function scheduleReconnect(key: string, runGeneration: number): Promise<void> {
	const current = active.get(key);
	if (!current || runGeneration !== generation || current.reconnectTimer || current.reconnectPending) return;
	current.reconnectPending = true;
	current.unsubscribe();
	await current.connector.stop().catch(() => undefined);
	if (runGeneration !== generation) {
		current.reconnectPending = false;
		return;
	}
	const delayMs = current.reconnectDelayMs;
	current.reconnectDelayMs = Math.min(30_000, current.reconnectDelayMs * 2);
	current.reconnectTimer = setTimeout(() => {
		current.reconnectTimer = undefined;
		if (active.get(key) === current)
			void connect(current.options, current.options, key, runGeneration, current.reconnectDelayMs);
	}, delayMs);
	current.reconnectTimer.unref?.();
	current.reconnectPending = false;
	log.info("remote access reconnect scheduled", { delayMs, key });
}

function aggregateState(): RemoteConnectionState {
	const states = [...targetStates.values()];
	if (states.includes("online")) return "online";
	if (states.includes("connecting")) return "connecting";
	if (states.includes("reconnecting") || states.includes("recovering")) return "reconnecting";
	if (states.length > 0 && states.every((state) => state === "failed")) return "failed";
	return states.at(-1) ?? "idle";
}
