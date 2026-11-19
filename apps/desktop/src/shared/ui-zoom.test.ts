import { describe, expect, it } from "vitest";
import {
	normalizeUiZoomFactor,
	stepUiZoomFactor,
	UI_ZOOM_DEFAULT,
	UI_ZOOM_STEPS,
	uiZoomNeedsCorrection,
} from "./ui-zoom";

describe("normalizeUiZoomFactor", () => {
	it("非数字或非有限数回落默认值", () => {
		for (const bad of [undefined, null, "1.2", Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(normalizeUiZoomFactor(bad)).toBe(UI_ZOOM_DEFAULT);
		}
	});

	it("档位值原样保留", () => {
		for (const step of UI_ZOOM_STEPS) expect(normalizeUiZoomFactor(step)).toBe(step);
	});

	it("越界夹到首尾档，其余吸附到最近一档（旧配置里的任意比例也能落到档上）", () => {
		expect(normalizeUiZoomFactor(0.1)).toBe(0.75);
		expect(normalizeUiZoomFactor(9)).toBe(1.5);
		expect(normalizeUiZoomFactor(1.04)).toBe(1);
		expect(normalizeUiZoomFactor(1.2)).toBe(1.25);
	});
});

describe("stepUiZoomFactor", () => {
	it("按档位逐档移动", () => {
		expect(stepUiZoomFactor(1, 1)).toBe(1.1);
		expect(stepUiZoomFactor(1.1, 1)).toBe(1.25);
		expect(stepUiZoomFactor(1, -1)).toBe(0.9);
	});

	it("到头不越界", () => {
		expect(stepUiZoomFactor(1.5, 1)).toBe(1.5);
		expect(stepUiZoomFactor(0.75, -1)).toBe(0.75);
	});
});

describe("uiZoomNeedsCorrection", () => {
	it("实测与档位一致（含 Chromium 的浮点误差）时不纠正", () => {
		expect(uiZoomNeedsCorrection(1.1, 1.1)).toBe(false);
		expect(uiZoomNeedsCorrection(1.1000000001, 1.1)).toBe(false);
	});

	it("实测偏离档位就纠正：显示 110% 实际却是 100% 或 90%", () => {
		expect(uiZoomNeedsCorrection(1, 1.1)).toBe(true);
		expect(uiZoomNeedsCorrection(0.9, 1.1)).toBe(true);
	});

	it("取不到有效实测值时不动，避免乱写", () => {
		for (const bad of [undefined, null, Number.NaN, 0, -1, "1.1"]) {
			expect(uiZoomNeedsCorrection(bad, 1.1)).toBe(false);
		}
	});
});
