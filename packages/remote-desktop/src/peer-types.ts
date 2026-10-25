/// <reference lib="dom" />

export interface RemoteDesktopLogger {
	debug(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
	info(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
	warn(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
}

export const NOOP_REMOTE_DESKTOP_LOGGER: RemoteDesktopLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

/** STUN mapping only; same list as Android. A caller may override the full RTC configuration. */
export const REMOTE_DESKTOP_ICE_SERVERS: RTCIceServer[] = [
	{ urls: ["stun:stun.miwifi.com:3478", "stun:stun.chat.bilibili.com:3478", "stun:stun.hitv.com:3478"] },
];

export interface RemoteDesktopPeerOptions {
	readonly sessionId: string;
	readonly pointerMode?: "absolute" | "relative";
	readonly inputEnabled?: boolean;
	readonly rtcConfiguration?: RTCConfiguration;
	readonly logger?: RemoteDesktopLogger;
	readonly createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}
