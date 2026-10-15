export const REMOTE_PAIRING_CHANNELS = {
	getState: "agent567:remote-pairing:get-state",
	create: "agent567:remote-pairing:create",
	resetCertificate: "agent567:remote-pairing:reset-certificate",
	setAutoShareScreen: "agent567:remote-pairing:set-auto-share-screen",
	setInputEnabled: "agent567:remote-pairing:set-input-enabled",
	installInputDependencies: "agent567:remote-pairing:install-input-dependencies",
	revoke: "agent567:remote-pairing:revoke",
} as const;

export type RemotePairingErrorCode =
	| "credentials_unreadable"
	| "secure_storage_unavailable"
	| "invalid_relay_url"
	| "operation_failed";
