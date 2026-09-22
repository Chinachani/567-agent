import { RemoteDesktopHost, WebSocketRemoteDesktopSignaling } from "@vetta/remote-desktop";

declare global {
	interface Window {
		vettaRemoteDesktop?: { onInput(message: unknown): void };
	}
}

const params = new URLSearchParams(window.location.search);
const target = params.get("target");
const sessionId = params.get("sessionId");
if (!target || !sessionId) throw new Error("remote desktop host target is missing");

const signaling = new WebSocketRemoteDesktopSignaling(target);
let host: RemoteDesktopHost | undefined;
let stream: MediaStream | undefined;
let isStarting = false;

async function startHostWithStream(): Promise<void> {
	if (host || isStarting) return;
	isStarting = true;
	try {
		console.info("peer ready received, requesting display media capture...");
		stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
		host = new RemoteDesktopHost(
			{
				sessionId: sessionId!,
				logger: {
					debug: (message, fields) => console.debug(message, fields),
					info: (message, fields) => console.info(message, fields),
					warn: (message, fields) => console.warn(message, fields),
				},
			},
			async (signal) => signaling.send(signal),
			(message) => window.vettaRemoteDesktop?.onInput(message),
		);
		await host.start(stream, { waitForPeerReady: false });
		console.info("remote desktop host started successfully with active stream");
	} catch (err) {
		console.warn("display media capture failed or cancelled by user", err);
		isStarting = false;
	}
}

await signaling.connect({
	async onSignal(signal) {
		if (signal.type === "peer_ready") {
			await startHostWithStream();
			return;
		}
		if (host) {
			void host.acceptSignal(signal);
		}
	},
	onClose(reason) {
		console.warn("remote desktop signaling closed", reason);
		stream?.getTracks().forEach((t) => {
			t.stop();
		});
		setTimeout(() => window.location.reload(), 2_000);
	},
});

console.info("remote desktop host signaling connected, waiting for mobile peer_ready...");
