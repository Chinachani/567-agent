import type {
	CodingAgentSandboxAuthorizationDecision,
	CodingAgentSandboxAuthorizationFunctionRequest,
} from "@567agent/coding-agent/function-extensions";

export type SandboxAuthorizationHandler = (
	request: CodingAgentSandboxAuthorizationFunctionRequest,
	signal?: AbortSignal,
) => Promise<CodingAgentSandboxAuthorizationDecision>;

/** Desktop renderer 生命周期与 Coding Agent sandbox authorization function 之间的可重绑路由。 */
export class DesktopSandboxAuthorizationBroker {
	private readonly pending = new Map<string, CodingAgentSandboxAuthorizationFunctionRequest>();

	hasPending(sessionId: string): boolean {
		return [...this.pending.values()].some((request) => request.sessionId === sessionId);
	}

	private interactiveHandler: SandboxAuthorizationHandler | undefined;

	isAvailable(): boolean {
		return this.interactiveHandler !== undefined;
	}

	readonly handle: SandboxAuthorizationHandler = async (request, signal) => {
		if (signal?.aborted) return Promise.resolve("deny");
		if (!this.interactiveHandler) return "deny";
		this.pending.set(request.requestId, request);
		try {
			return await this.interactiveHandler(request, signal);
		} finally {
			if (this.pending.get(request.requestId) === request) this.pending.delete(request.requestId);
		}
	};

	setInteractiveHandler(handler: SandboxAuthorizationHandler): () => void {
		this.interactiveHandler = handler;
		return () => {
			if (this.interactiveHandler === handler) this.interactiveHandler = undefined;
		};
	}
}

const sharedSandboxAuthorizationBroker = new DesktopSandboxAuthorizationBroker();

export function getDesktopSandboxAuthorizationBroker(): DesktopSandboxAuthorizationBroker {
	return sharedSandboxAuthorizationBroker;
}
