export interface RemotePairingState {
	status: "idle" | "ready" | "connected" | "error";
	relayBaseUrl?: string;
	pairingId?: string;
	inviteUri?: string;
	inputEnabled: boolean;
	inputSupported: boolean;
	inputSupportReason?:
		| "windows_api_unavailable"
		| "x11_display_unavailable"
		| "x11_libraries_unavailable"
		| "x11_open_display_failed"
		| "accessibility_permission_required"
		| "unsupported_platform";
	pairingWarnings?: Array<"certificate_changed" | "lan_unavailable">;
	error?: string;
}

export interface RemotePairingApi {
	getState(): Promise<RemotePairingState>;
	create(relayBaseUrl?: string): Promise<RemotePairingState>;
	setInputEnabled(enabled: boolean): Promise<RemotePairingState>;
	revoke(): Promise<RemotePairingState>;
}
