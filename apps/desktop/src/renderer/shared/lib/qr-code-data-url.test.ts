import { describe, expect, it, vi } from "vitest";

const { renderSvg } = vi.hoisted(() => ({
	renderSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'),
}));
vi.mock("qrcode", () => ({ default: { toString: renderSvg } }));

import { createQrCodeDataUrl } from "@shared/lib/qr-code-data-url";

describe("createQrCodeDataUrl", () => {
	it("renders an SVG data URL without relying on a canvas", async () => {
		const result = await createQrCodeDataUrl("agent567://pair?token=a&b", 280);

		expect(renderSvg).toHaveBeenCalledWith("agent567://pair?token=a&b", {
			type: "svg",
			errorCorrectionLevel: "M",
			margin: 1,
			width: 280,
			color: { dark: "#000000", light: "#ffffff" },
		});
		expect(result).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
		expect(decodeURIComponent(result.split(",")[1] ?? "")).toContain("<svg");
	});
});
