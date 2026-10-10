import { hostname } from "node:os";
import type { RemoteConnectionState } from "@567agent/remote-control";
import { RemoteConnection, WebSocketRemoteTransport } from "@567agent/remote-control";
import { app } from "electron";
import { readAbilityLedger } from "../abilities/ability-ledger.js";
import { getOpenMarketplaceManager } from "../abilities/open-marketplace/open-marketplace-manager.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { resolveDesktopRuntimeSessionRoots } from "../conversations/session-catalog-roots.js";
import { getAppLogger } from "../logger.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import { readPluginBlobRange } from "../plugins/plugin-storage-service.js";
import { DesktopConversationRemoteOperations } from "./desktop-conversation-remote-operations.js";
import { DesktopRemoteConnector } from "./desktop-remote-connector.js";
import { createDesktopWebSocketFactory } from "./desktop-websocket.js";

export interface DesktopRemoteAccessOptions {
	readonly controlUrl?: string;
	readonly pairingToken?: string;
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
let generation = 0;

export async function startDesktopRemoteAccess(options: DesktopRemoteAccessOptions): Promise<void> {
	if (active.size > 0) return;
	const runGeneration = ++generation;
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
			capabilities: { chat: true, sessionRead: true },
			logger: {
				debug: (message: string, metadata) => log.debug(message, metadata),
				info: (message: string, metadata) => log.info(message, metadata),
				warn: (message: string, metadata) => log.warn(message, metadata),
			},
		},
	);
	const operations = new DesktopConversationRemoteOperations(getDesktopConversationService(), {
		cwd: options.conversationCwd,
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
				installable: ability.installable !== false && ["skill", "scene", "plugin"].includes(ability.type),
				installed: Boolean(ledger[`${ability.type}:${ability.slug}`]),
			}));
			const listedKeys = new Set(listed.map((ability) => `${ability.type}:${ability.slug}`));
			const installedLocal = Object.entries(ledger).flatMap(([key, entry]) => {
				const separator = key.indexOf(":");
				if (separator <= 0) return [];
				const type = key.slice(0, separator);
				const slug = key.slice(separator + 1);
				if (listedKeys.has(key) || !["skill", "scene", "plugin", "mcp"].includes(type)) return [];
				return [
					{
						slug,
						type: type as "skill" | "scene" | "mcp" | "plugin",
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
		installToolbox: (type, slug) => getOpenMarketplaceManager(app.getVersion()).install(type, slug),
		allowSessionMigrationTransfer: options.allowSessionMigrationTransfer === true,
	});
	const connector = new DesktopRemoteConnector(connection, operations);
	const unsubscribe = connection.onEvent((event) => {
		if (event.type === "state") {
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
		unsubscribe,
		options,
		reconnectPending: false,
		reconnectDelayMs: 1_000,
	};
	active.set(key, entry);
	try {
		await connector.start();
		log.info("remote access connector started", { deviceId });
	} catch (error) {
		log.warn("remote access connection attempt failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		await scheduleReconnect(key, runGeneration);
	}
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
		void connect(current.options, current.options, key, runGeneration);
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
