import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ mac: true }));

vi.mock("@shared/lib/platform", () => ({
	get isMac() {
		return flags.mac;
	},
}));

import { getSetupWizardSteps } from "./steps";

describe("getSetupWizardSteps", () => {
	beforeEach(() => {
		flags.mac = true;
	});

	it("引导流程不包含当前未提供的云账号登录", () => {
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "permissions", "welcome"]);
	});

	it("非 macOS 跳过权限步", () => {
		flags.mac = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "welcome"]);
	});
});
