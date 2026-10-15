import type { RemotePairingErrorCode } from "../../shared/remote-pairing-ipc.js";

export class RemotePairingError extends Error {
	constructor(
		readonly code: RemotePairingErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RemotePairingError";
	}
}

export function remotePairingErrorCode(error: unknown): RemotePairingErrorCode {
	return error instanceof RemotePairingError ? error.code : "operation_failed";
}
