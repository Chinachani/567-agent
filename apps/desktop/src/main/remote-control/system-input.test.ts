import { afterEach, describe, expect, it, vi } from "vitest";
import { createSystemInputAdapter } from "./system-input.js";

afterEach(() => vi.unstubAllEnvs());

describe("createSystemInputAdapter", () => {
	it("selects the portal on Wayland and never prompts or grants input during adapter construction", () => {
		if (process.platform !== "linux") return;
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		vi.stubEnv("DISPLAY", undefined);
		const adapter = createSystemInputAdapter({ enabled: true });
		expect(adapter.supported).toBe(true);
		expect(adapter.pointerMode).toBe("relative");
		expect(adapter.granted).toBe(false);
		adapter.setEnabled(false);
	});
	it("keeps system input disabled unless explicitly granted", () => {
		const adapter = createSystemInputAdapter({ enabled: false });
		expect(() => adapter.apply({ type: "pointer.move", sequence: 1, x: 0.5, y: 0.5 })).not.toThrow();
		if (process.platform === "win32") expect(adapter.supported).toBe(true);
		if (process.platform === "linux" && !process.env.DISPLAY) expect(adapter.supported).toBe(false);
	});

	it("does not claim support on a platform without a native adapter", () => {
		const adapter = createSystemInputAdapter({ enabled: true });
		if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
			expect(adapter.supported).toBe(false);
		}
	});
});
