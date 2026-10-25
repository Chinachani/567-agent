export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type RemoteRole = "mobile" | "desktop" | "relay";
export type RemoteConnectionState =
	| "idle"
	| "connecting"
	| "online"
	| "recovering"
	| "reconnecting"
	| "closed"
	| "failed";

export const REMOTE_REQUEST_METHODS = [
	"session.list",
	"session.delete",
	"session.delete.empty",
	"session.create",
	"session.open",
	"session.history",
	"session.prompt",
	"session.turn.read",
	"session.models",
	"session.context",
	"session.context.compact",
	"session.context.cancel",
	"session.context.auto",
	"session.context.selection",
	"session.workbench",
	"session.workbench.detail",
	"session.collaboration.read",
	"session.collaboration.update",
	"session.collaboration.control",
	"session.attachment.read",
	"session.model.select",
	"session.suggestions",
	"session.suggestions.cancel",
	"session.image.read",
	"session.attachment.transfer.start",
	"session.attachment.transfer.chunk",
	"session.attachment.transfer.finish",
	"session.attachment.transfer.cancel",
	"session.migration.receive.start",
	"session.migration.receive.chunk",
	"session.migration.receive.finish",
	"session.migration.receive.import",
	"session.migration.receive.cancel",
	"session.respond",
	"session.abort",
	"session.resume",
	"toolbox.list",
	"toolbox.install",
	"diagnostics.snapshot",
] as const;

/** Selection affects model input only; the canonical conversation is never rewritten. */
export interface ContextSelection {
	readonly revision: number;
	readonly pinnedText: string;
	readonly excludedTurnIds: readonly string[];
}
export interface ContextWorkspaceSnapshot extends ContextSelection {
	readonly sessionId: string;
	readonly documentRevision: number;
	readonly busy: boolean;
	readonly summary: string;
	readonly previousSummary: string;
	readonly tokensBefore: number | null;
	readonly totalTurns: number;
	readonly turns: readonly {
		readonly id: string;
		readonly text: string;
		readonly attachments: readonly string[];
		readonly status: "included" | "summarized" | "excluded";
	}[];
}

export interface RemoteSessionContext {
	readonly workspace?: ContextWorkspaceSnapshot;
	readonly tokens: number | null;
	readonly contextWindow: number | null;
	readonly contextWindowSource?: "manual" | "api" | "catalog" | "unknown";
	readonly estimated: boolean;
	readonly messageCount: number;
	readonly autoCompactionEnabled: boolean;
	readonly busy: boolean;
}

export interface RemoteCapabilities {
	readonly chat: boolean;
	readonly sessionRead: boolean;
	readonly fileRead?: boolean;
	readonly fileWrite?: boolean;
	readonly terminal?: boolean;
	readonly screen?: boolean;
	readonly input?: boolean;
}

export interface RemoteHello {
	readonly type: "hello";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId: string;
}

export interface RemoteHelloAck {
	readonly type: "hello_ack";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly connectionId: string;
	readonly peerDeviceId: string;
}

export interface RemoteRequest {
	readonly type: "request";
	readonly requestId: string;
	readonly method: (typeof REMOTE_REQUEST_METHODS)[number];
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export interface RemoteResponse {
	readonly type: "response";
	readonly requestId: string;
	readonly success: boolean;
	readonly payload?: unknown;
	readonly error?: RemoteError;
}

export interface RemoteEvent {
	readonly type: "event";
	readonly eventId: string;
	readonly sequence: number;
	readonly name: RemoteEventName;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export type RemoteEventName =
	| "device.status"
	| "session.state"
	| "session.message"
	| "session.tool"
	| "session.input"
	| "diagnostics.updated";

export interface RemoteAck {
	readonly type: "ack";
	readonly sequence: number;
}

export interface RemoteResume {
	readonly type: "resume";
	readonly lastEventSequence: number;
}

export interface RemoteError {
	readonly code:
		| "invalid_frame"
		| "unsupported_version"
		| "unauthorized"
		| "not_found"
		| "busy"
		| "request_timeout"
		| "transport_closed"
		| "internal_error";
	readonly message: string;
	readonly retryable: boolean;
}

export type RemoteFrame =
	| RemoteHello
	| RemoteHelloAck
	| RemoteRequest
	| RemoteResponse
	| RemoteEvent
	| RemoteAck
	| RemoteResume;

export interface RemoteDiagnostics {
	readonly state: RemoteConnectionState;
	readonly deviceId: string;
	readonly connectionId: string;
	readonly lastEventSequence: number;
	readonly lastAckSequence: number;
	readonly pendingRequestCount: number;
	readonly reconnectCount: number;
	readonly lastRttMs?: number;
	readonly lastErrorCode?: RemoteError["code"];
}

export interface RemoteLogger {
	debug(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	info(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	warn(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
}

export const NOOP_REMOTE_LOGGER: RemoteLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

export interface RemoteTransport {
	connect(handlers: RemoteTransportHandlers): Promise<void>;
	send(frame: RemoteFrame): Promise<void>;
	close(): Promise<void>;
}

export interface RemoteTransportHandlers {
	onFrame(frame: RemoteFrame): void;
	onClose(reason?: string): void;
}

export interface RemoteConnectionOptions {
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId?: string;
	readonly requestTimeoutMs?: number;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
}

export interface RemoteConnectionSnapshot extends RemoteDiagnostics {
	readonly peerDeviceId?: string;
}

export type RemoteConnectionEvent =
	| { readonly type: "state"; readonly state: RemoteConnectionState }
	| { readonly type: "remote-request"; readonly request: RemoteRequest }
	| { readonly type: "remote-event"; readonly event: RemoteEvent }
	| { readonly type: "error"; readonly error: RemoteError };

export interface SessionAttachmentAsset {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly kind: "file" | "directory" | "image";
}
export interface SessionTaskAsset {
	readonly id: string;
	readonly title: string;
	readonly status: "completed" | "failed" | "running" | "interrupted";
	readonly timestamp: number;
	readonly durationMs: number | null;
	readonly toolCount: number;
}
export interface SessionChangeAsset {
	readonly id: string;
	readonly path: string;
	readonly status: "pending" | "kept" | "reverted";
	readonly reversible: boolean;
}
export interface SessionWorkbenchSnapshot {
	readonly attachments: readonly SessionAttachmentAsset[];
	readonly tasks: readonly SessionTaskAsset[];
	readonly changes: readonly SessionChangeAsset[];
}
export interface SessionWorkbenchDetail {
	readonly kind: "attachment" | "task" | "change";
	readonly id: string;
	readonly title: string;
	readonly text: string;
	readonly path?: string;
	readonly sizeBytes?: number;
	readonly previewStatus?: "text" | "binary" | "unavailable";
	/** Optional bounded raster preview, fetched on demand; never the original file. */
	readonly thumbnailDataUrl?: string;
	readonly beforeText?: string;
	readonly afterText?: string;
	readonly afterRevision?: string;
	readonly reversible?: boolean;
}
