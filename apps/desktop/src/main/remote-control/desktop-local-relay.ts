import { createServer, type Server } from "node:https";
import { networkInterfaces } from "node:os";
import {
	encodeRemoteFrame,
	parseRemoteFrame,
	REMOTE_REQUEST_METHODS,
	type RemoteFrame,
	type RemoteHello,
	type RemoteResponse,
} from "@567agent/remote-control";
import { encodeRemoteDesktopSignal, REMOTE_DESKTOP_PROTOCOL_VERSION } from "@567agent/remote-desktop/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("local-relay");
const DEFAULT_PORT = 18789;
const _REMOTE_WEBSOCKET_PROTOCOL = "vetta.remote.v1";
const KNOWN_REMOTE_REQUEST_METHODS = new Set<string>(REMOTE_REQUEST_METHODS);
const VIRTUAL_INTERFACE_NAME =
	/(?:^|[^a-z0-9])(?:tun|tap|wg|wireguard|wintun|utun|vpn|tunnel|tailscale|zerotier|zt|clash|sing[-_ ]?box|docker|podman|veth|virbr|vmnet|vbox|hyper[-_ ]?v|vEthernet|bridge|br-)[a-z0-9._-]*(?:$|[^a-z0-9])/i;

export interface DesktopLocalRelayTlsOptions {
	readonly certificate: string;
	readonly privateKey: string;
}

export interface DesktopLocalRelayPairingCredentials {
	readonly pairingId: string;
	readonly desktopSecret: string;
	readonly bootstrapSecret?: string;
	readonly resumeSecret?: string;
	readonly onResumeSecret?: (secret: string) => void;
}

interface PairRoom {
	desktop?: WebSocket;
	mobile?: WebSocket;
	desktopHello?: RemoteHello;
	mobileHello?: RemoteHello;
	resumeSecret?: string;
}

interface DesktopRoom {
	host?: WebSocket;
	viewer?: WebSocket;
}

export class DesktopLocalRelay {
	private server: Server | undefined;
	private wss: WebSocketServer | undefined;
	private port: number = DEFAULT_PORT;
	private readonly pairRooms = new Map<string, PairRoom>();
	private readonly desktopRooms = new Map<string, DesktopRoom>();
	private credentials: DesktopLocalRelayPairingCredentials | undefined;

	async start(
		tls: DesktopLocalRelayTlsOptions,
		credentials: DesktopLocalRelayPairingCredentials,
		preferredPort = DEFAULT_PORT,
	): Promise<number> {
		if (this.server) return this.port;
		this.credentials = credentials;

		return new Promise<number>((resolve, reject) => {
			let fallbackAttempted = false;
			let startupSettled = false;
			const server = createServer({ cert: tls.certificate, key: tls.privateKey }, (req, res) => {
				if (req.url === "/health") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "ok", protocolVersion: 1, local: true }));
					return;
				}
				res.writeHead(404);
				res.end();
			});

			const wss = new WebSocketServer({ noServer: true });

			server.on("upgrade", (request, socket, head) => {
				const url = new URL(request.url ?? "/", `http://${request.headers.host || "localhost"}`);
				const relayMatch = /^\/v1\/relay\/([^/]+)\/(mobile|desktop)$/.exec(url.pathname);
				const desktopMatch = /^\/v1\/desktop\/([^/]+)\/(host|viewer)$/.exec(url.pathname);

				if (!relayMatch && !desktopMatch) {
					log.warn("local relay websocket rejected", { reason: "unknown_route" });
					socket.destroy();
					return;
				}
				const requestedProtocols = readRequestedProtocols(request.headers["sec-websocket-protocol"]);
				const resumeSecret = this.authorizeConnection(relayMatch ?? desktopMatch!, requestedProtocols);
				if (resumeSecret === false) {
					log.warn("local relay websocket rejected", {
						channel: relayMatch ? "control" : "screen",
						role: (relayMatch ?? desktopMatch)![2],
						reason: "credential_rejected",
					});
					socket.destroy();
					return;
				}

				log.info("local relay websocket accepted", {
					channel: relayMatch ? "control" : "screen",
					role: (relayMatch ?? desktopMatch)![2],
				});
				wss.handleUpgrade(request, socket, head, (ws) => {
					if (relayMatch) {
						this.handleRelayConnection(
							ws,
							relayMatch[1],
							relayMatch[2] as "mobile" | "desktop",
							resumeSecret || undefined,
						);
					} else if (desktopMatch) {
						this.handleDesktopConnection(ws, desktopMatch[1], desktopMatch[2] as "host" | "viewer");
					}
				});
			});

			server.listen(preferredPort, "0.0.0.0", () => {
				startupSettled = true;
				this.server = server;
				this.wss = wss;
				const addr = server.address();
				this.port = typeof addr === "object" && addr ? addr.port : preferredPort;
				log.info("local relay server started", { port: this.port, lanIp: this.getLanIp() });
				resolve(this.port);
			});

			server.on("error", (err: unknown) => {
				if (startupSettled) {
					log.warn("local relay server reported an error after startup", {
						error: err instanceof Error ? err.message : String(err),
					});
					return;
				}
				const msg = err instanceof Error ? err.message : String(err);
				log.warn("local relay listen error, trying fallback port", { error: msg });
				if (preferredPort !== 0 && !fallbackAttempted) {
					fallbackAttempted = true;
					server.listen(0, "0.0.0.0", () => {
						startupSettled = true;
						this.server = server;
						this.wss = wss;
						const addr = server.address();
						this.port = typeof addr === "object" && addr ? addr.port : 0;
						log.info("local relay server started on fallback port", { port: this.port });
						resolve(this.port);
					});
				} else {
					startupSettled = true;
					this.credentials = undefined;
					this.wss = undefined;
					reject(err);
				}
			});
		});
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		for (const room of this.pairRooms.values()) {
			room.desktop?.close();
			room.mobile?.close();
		}
		this.pairRooms.clear();
		for (const room of this.desktopRooms.values()) {
			room.host?.close();
			room.viewer?.close();
		}
		this.desktopRooms.clear();
		this.credentials = undefined;

		await new Promise<void>((resolve) => {
			this.wss?.close(() => {
				this.server?.close(() => {
					this.server = undefined;
					this.wss = undefined;
					resolve();
				});
			});
		});
		log.info("local relay server stopped");
	}

	getLanIp(): string {
		const nets = networkInterfaces();
		const candidates = Object.entries(nets).flatMap(([name, entries]) =>
			(entries ?? [])
				.filter((entry) => entry.family === "IPv4" && !entry.internal && isPrivateIPv4(entry.address))
				.map((entry) => ({ name, address: entry.address, virtual: VIRTUAL_INTERFACE_NAME.test(name) })),
		);
		const physicalCandidates = candidates.filter((candidate) => !candidate.virtual);
		const preferred = (physicalCandidates.length > 0 ? physicalCandidates : candidates).sort((left, right) => {
			const subnetRank = (address: string): number =>
				address.startsWith("192.168.") ? 0 : address.startsWith("10.") ? 1 : 2;
			return subnetRank(left.address) - subnetRank(right.address);
		});
		return preferred[0]?.address ?? "127.0.0.1";
	}

	getLanUrl(): string {
		return `https://${this.getLanIp()}:${this.port}`;
	}

	isListening(): boolean {
		return Boolean(this.server?.listening);
	}

	private handleRelayConnection(
		ws: WebSocket,
		pairingId: string,
		role: "mobile" | "desktop",
		resumeSecret?: string,
	): void {
		let room = this.pairRooms.get(pairingId);
		if (!room) {
			room = {};
			this.pairRooms.set(pairingId, room);
		}
		if (role === "mobile" && resumeSecret && room.resumeSecret !== resumeSecret) {
			room.resumeSecret = resumeSecret;
			if (this.credentials) this.credentials = { ...this.credentials, resumeSecret };
			this.credentials?.onResumeSecret?.(resumeSecret);
		}

		if (role === "desktop") {
			room.desktop?.close(4001, "Replaced");
			room.desktop = ws;
		} else {
			room.mobile?.close(4001, "Replaced");
			room.mobile = ws;
		}

		ws.on("message", (data) => {
			const str = data.toString("utf8");
			for (const line of str.split("\n").filter(Boolean)) {
				let frame: RemoteFrame;
				try {
					frame = parseRemoteFrame(line);
				} catch {
					log.warn("local relay frame rejected", { role, reason: "invalid_frame" });
					const unsupported = readUnsupportedRequest(line);
					if (role === "mobile" && unsupported) {
						const response: RemoteResponse = {
							type: "response",
							requestId: unsupported.requestId,
							success: false,
							error: {
								code: "invalid_frame",
								message: "Unsupported remote request method",
								retryable: false,
							},
						};
						ws.send(encodeRemoteFrame(response));
					}
					continue;
				}

				if (frame.type === "hello") {
					if (role === "desktop") room!.desktopHello = frame;
					else room!.mobileHello = frame;
					log.info("local relay hello received", {
						role,
						protocolVersion: frame.protocolVersion,
						peerSocketConnected: role === "desktop" ? Boolean(room!.mobile) : Boolean(room!.desktop),
					});

					if (room!.desktop && room!.mobile && room!.desktopHello && room!.mobileHello) {
						room!.mobile.send(
							`${encodeRemoteFrame({
								type: "hello_ack",
								protocolVersion: 1,
								connectionId: room!.mobileHello.connectionId,
								peerDeviceId: room!.desktopHello.deviceId,
							})}\n`,
						);
						room!.desktop.send(
							`${encodeRemoteFrame({
								type: "hello_ack",
								protocolVersion: 1,
								connectionId: room!.desktopHello.connectionId,
								peerDeviceId: room!.mobileHello.deviceId,
							})}\n`,
						);
						log.info("local relay pair online", { pairingId });
					}
					continue;
				}

				const peer = role === "desktop" ? room!.mobile : room!.desktop;
				if (peer && peer.readyState === WebSocket.OPEN) {
					peer.send(`${line}\n`);
				}
			}
		});

		ws.on("close", (code) => {
			log.info("local relay websocket closed", {
				role,
				code,
				helloReceived: role === "desktop" ? Boolean(room!.desktopHello) : Boolean(room!.mobileHello),
				peerHelloReceived: role === "desktop" ? Boolean(room!.mobileHello) : Boolean(room!.desktopHello),
			});
			if (role === "desktop" && room!.desktop === ws) {
				room!.desktop = undefined;
				room!.desktopHello = undefined;
				room!.mobile?.close(1012, "Desktop disconnected");
			} else if (role === "mobile" && room!.mobile === ws) {
				room!.mobile = undefined;
				room!.mobileHello = undefined;
				room!.desktop?.close(1012, "Mobile disconnected");
			}
			if (!room!.desktop && !room!.mobile) {
				this.pairRooms.delete(pairingId);
			}
		});
	}

	private authorizeConnection(match: RegExpExecArray, protocols: ReadonlySet<string>): string | undefined | false {
		const credentials = this.credentials;
		if (!credentials || match[1] !== credentials.pairingId) return false;
		const role = match[2];
		const pairing = protocolValue(protocols, "vetta.pairing.");
		if (role === "desktop" || role === "host") return pairing === credentials.desktopSecret ? undefined : false;
		if (role === "mobile") {
			const resume = protocolValue(protocols, "vetta.resume.");
			if (credentials.bootstrapSecret && pairing === credentials.bootstrapSecret && resume) return resume;
			if (credentials.resumeSecret && pairing === credentials.resumeSecret) return credentials.resumeSecret;
			return false;
		}
		if (role === "viewer" && credentials.resumeSecret && pairing === credentials.resumeSecret) {
			return credentials.resumeSecret;
		}
		return false;
	}

	private handleDesktopConnection(ws: WebSocket, pairingId: string, role: "host" | "viewer"): void {
		let room = this.desktopRooms.get(pairingId);
		if (!room) {
			room = {};
			this.desktopRooms.set(pairingId, room);
		}

		if (role === "host") {
			room.host?.close(4001, "Replaced");
			room.host = ws;
		} else {
			room.viewer?.close(4001, "Replaced");
			room.viewer = ws;
		}

		if (room.host && room.viewer) {
			room.host.send(
				encodeRemoteDesktopSignal({
					type: "peer_ready",
					protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				}),
			);
		}

		ws.on("message", (data) => {
			const str = data.toString("utf8");
			const peer = role === "host" ? room!.viewer : room!.host;
			if (peer && peer.readyState === WebSocket.OPEN) {
				peer.send(str);
			}
		});

		ws.on("close", () => {
			if (role === "host" && room!.host === ws) {
				room!.host = undefined;
				room!.viewer?.close(1012, "Host disconnected");
			} else if (role === "viewer" && room!.viewer === ws) {
				room!.viewer = undefined;
				room!.host?.close(1012, "Viewer disconnected");
			}
			if (!room!.host && !room!.viewer) {
				this.desktopRooms.delete(pairingId);
			}
		});
	}
}

function readUnsupportedRequest(line: string): { requestId: string; method: string } | undefined {
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		const frame = value as Record<string, unknown>;
		if (
			frame.type !== "request" ||
			typeof frame.requestId !== "string" ||
			frame.requestId.length === 0 ||
			frame.requestId.length > 256 ||
			typeof frame.method !== "string" ||
			frame.method.length === 0 ||
			frame.method.length > 128
		) {
			return undefined;
		}
		return !KNOWN_REMOTE_REQUEST_METHODS.has(frame.method)
			? { requestId: frame.requestId, method: frame.method }
			: undefined;
	} catch {
		return undefined;
	}
}

function isPrivateIPv4(address: string): boolean {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	return (
		octets[0] === 10 ||
		(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
		(octets[0] === 192 && octets[1] === 168)
	);
}

function readRequestedProtocols(value: string | string[] | undefined): ReadonlySet<string> {
	const header = Array.isArray(value) ? value.join(",") : (value ?? "");
	return new Set(
		header
			.split(",")
			.map((protocol) => protocol.trim())
			.filter(Boolean),
	);
}

function protocolValue(protocols: ReadonlySet<string>, prefix: string): string | undefined {
	for (const protocol of protocols) {
		if (protocol.startsWith(prefix)) return protocol.slice(prefix.length) || undefined;
	}
	return undefined;
}

let localRelayInstance: DesktopLocalRelay | undefined;

export function getDesktopLocalRelay(): DesktopLocalRelay {
	if (!localRelayInstance) {
		localRelayInstance = new DesktopLocalRelay();
	}
	return localRelayInstance;
}
