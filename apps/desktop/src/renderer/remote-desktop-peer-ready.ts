import { REMOTE_DESKTOP_PROTOCOL_VERSION, type RemoteDesktopHost } from "@567agent/remote-desktop";

/** Reuse a healthy host across signaling reconnects; only a missing host needs capture. */
export async function handleRemoteDesktopPeerReady(
	host: Pick<RemoteDesktopHost, "acceptSignal"> | undefined,
	requestCapture: () => void,
): Promise<void> {
	if (!host) {
		requestCapture();
		return;
	}
	await host.acceptSignal({ type: "peer_ready", protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION });
}
