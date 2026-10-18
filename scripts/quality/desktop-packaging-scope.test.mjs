import { describe, expect, it } from "vitest";
import { classifyDesktopPackagingRisk } from "./desktop-packaging-scope.mjs";

describe("Desktop packaging risk classification", () => {
	it("requires native packaging coverage for installer and migration changes", () => {
		const paths = [
			"apps/desktop/build/installer.iss",
			"apps/desktop/build/installer.zh-cn.isl",
			"apps/desktop/scripts/build-inno-installer.mjs",
			"apps/desktop/scripts/inno-installer-process.mjs",
			"apps/desktop/scripts/verify-inno-install.mjs",
			"apps/desktop/scripts/verify-inno-update.mjs",
		];
		expect(classifyDesktopPackagingRisk(paths)).toEqual({ packagedSmokeRequired: true, reasons: paths.sort() });
	});
	it("requires packaged smoke for main, preload, packaging and remote changes", () => {
		const result = classifyDesktopPackagingRisk([
			"apps/desktop/src/main/remote-control/desktop-remote-pairing-service.ts",
			"apps/desktop/src/preload/api-types/remote-pairing.ts",
			"apps/desktop/scripts/prepare-pack.js",
			"apps/desktop/scripts/desktop-build-environment.mjs",
			"packages/remote-control/src/index.ts",
		]);
		expect(result.packagedSmokeRequired).toBe(true);
		expect(result.reasons).toHaveLength(5);
	});

	it("does not require packaged smoke for unrelated renderer work", () => {
		const result = classifyDesktopPackagingRisk(["apps/desktop/src/renderer/domains/conversation/ChatPage.tsx"]);
		expect(result).toEqual({ packagedSmokeRequired: false, reasons: [] });
	});

	it("normalizes Windows paths and removes duplicate reasons", () => {
		const result = classifyDesktopPackagingRisk([
			"apps\\desktop\\src\\main\\main.ts",
			"apps/desktop/src/main/main.ts",
		]);
		expect(result).toEqual({ packagedSmokeRequired: true, reasons: ["apps/desktop/src/main/main.ts"] });
	});
});
