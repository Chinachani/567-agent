export interface LinkedAbortSignal {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
	dispose(): void;
}

export function createLinkedAbortSignal(parent: AbortSignal | undefined): LinkedAbortSignal {
	const controller = new AbortController();
	const abortFromParent = () => controller.abort(parent?.reason);
	if (parent?.aborted) {
		abortFromParent();
	} else {
		parent?.addEventListener("abort", abortFromParent, { once: true });
	}

	return {
		signal: controller.signal,
		abort: (reason) => controller.abort(reason),
		dispose: () => parent?.removeEventListener("abort", abortFromParent),
	};
}
