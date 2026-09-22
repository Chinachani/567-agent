import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { encodeRemoteFrame, parseRemoteFrame, type RemoteFrame, type RemoteHello } from "@vetta/remote-control";
import { encodeRemoteDesktopSignal, REMOTE_DESKTOP_PROTOCOL_VERSION } from "@vetta/remote-desktop/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("local-relay");
const DEFAULT_PORT = 18789;
const _REMOTE_WEBSOCKET_PROTOCOL = "vetta.remote.v1";

interface PairRoom {
	desktop?: WebSocket;
	mobile?: WebSocket;
	desktopHello?: RemoteHello;
	mobileHello?: RemoteHello;
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

	async start(preferredPort = DEFAULT_PORT): Promise<number> {
		if (this.server) return this.port;

		return new Promise<number>((resolve, reject) => {
			const server = createServer((req, res) => {
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
					socket.destroy();
					return;
				}

				wss.handleUpgrade(request, socket, head, (ws) => {
					if (relayMatch) {
						this.handleRelayConnection(ws, relayMatch[1], relayMatch[2] as "mobile" | "desktop");
					} else if (desktopMatch) {
						this.handleDesktopConnection(ws, desktopMatch[1], desktopMatch[2] as "host" | "viewer");
					}
				});
			});

			server.listen(preferredPort, "0.0.0.0", () => {
				this.server = server;
				this.wss = wss;
				const addr = server.address();
				this.port = typeof addr === "object" && addr ? addr.port : preferredPort;
				log.info("local relay server started", { port: this.port, lanIp: this.getLanIp() });
				resolve(this.port);
			});

			server.on("error", (err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				log.warn("local relay listen error, trying fallback port", { error: msg });
				if (preferredPort !== 0) {
					server.listen(0, "0.0.0.0", () => {
						this.server = server;
						this.wss = wss;
						const addr = server.address();
						this.port = typeof addr === "object" && addr ? addr.port : 0;
						log.info("local relay server started on fallback port", { port: this.port });
						resolve(this.port);
					});
				} else {
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
		for (const name of Object.keys(nets)) {
			for (const net of nets[name] ?? []) {
				if (net.family === "IPv4" && !net.internal) {
					if (net.address.startsWith("192.168.") || net.address.startsWith("10.")) {
						return net.address;
					}
				}
			}
		}
		for (const name of Object.keys(nets)) {
			for (const net of nets[name] ?? []) {
				if (net.family === "IPv4" && !net.internal) {
					return net.address;
				}
			}
		}
		return "127.0.0.1";
	}

	getLanUrl(): string {
		return `http://${this.getLanIp()}:${this.port}`;
	}

	isListening(): boolean {
		return Boolean(this.server?.listening);
	}

	private handleRelayConnection(ws: WebSocket, pairingId: string, role: "mobile" | "desktop"): void {
		let room = this.pairRooms.get(pairingId);
		if (!room) {
			room = {};
			this.pairRooms.set(pairingId, room);
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
					continue;
				}

				if (frame.type === "hello") {
					if (role === "desktop") room!.desktopHello = frame;
					else room!.mobileHello = frame;

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

		ws.on("close", () => {
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

let localRelayInstance: DesktopLocalRelay | undefined;

export function getDesktopLocalRelay(): DesktopLocalRelay {
	if (!localRelayInstance) {
		localRelayInstance = new DesktopLocalRelay();
	}
	return localRelayInstance;
}
