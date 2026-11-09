// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useUiZoom } from "./useUiZoom";
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
afterEach(cleanup);
it("ignores stale initial reads and save responses after newer broadcasts, and retries failed saves", async () => {
	const first = deferred<number>();
	const write = deferred<number>();
	let changed!: (value: number) => void;
	const set = vi
		.fn()
		.mockReturnValueOnce(write.promise)
		.mockRejectedValueOnce(new Error("disk full"))
		.mockResolvedValue(1.1);
	const off = vi.fn();
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			uiZoom: {
				get: () => first.promise,
				set,
				onChanged: (handler: typeof changed) => {
					changed = handler;
					return off;
				},
			},
		},
	});
	const hook = renderHook(() => useUiZoom());
	act(() => changed(1.25));
	await act(async () => first.resolve(1));
	expect(hook.result.current.factor).toBe(1.25);
	let save!: Promise<void>;
	act(() => {
		save = hook.result.current.setFactor(1.5);
	});
	expect(hook.result.current.saving).toBe(true);
	await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
	act(() => changed(0.9));
	await act(async () => {
		write.resolve(1.5);
		await save;
	});
	expect(hook.result.current.factor).toBe(0.9);
	await act(async () => hook.result.current.setFactor(1.1));
	expect(hook.result.current.factor).toBe(0.9);
	expect(hook.result.current.saving).toBe(false);
	await act(async () => hook.result.current.setFactor(1.1));
	expect(hook.result.current.factor).toBe(1.1);
	hook.unmount();
	expect(off).toHaveBeenCalledOnce();
});
