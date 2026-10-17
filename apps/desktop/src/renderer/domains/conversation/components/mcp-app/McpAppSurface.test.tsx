// @vitest-environment jsdom
import type { DesktopApi, DesktopMcpAppSurface } from "@preload/api";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpAppSurface } from "./McpAppSurface";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", resolvedLanguage: "en" } }),
}));

const SURFACE: DesktopMcpAppSurface = {
	id: "mcp-app-1",
	resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app", html: "<main>app</main>" },
	toolResult: { content: [] },
	capabilities: { serverTools: false, serverResources: true },
};

describe("McpAppSurface", () => {
	it("uses an opaque-origin outer proxy and accepts ready messages only from that exact window", async () => {
		let resolveSurface: (surface: DesktopMcpAppSurface) => void = () => {
			throw new Error("Surface promise is not initialized");
		};
		const surfacePromise = new Promise<DesktopMcpAppSurface>((resolve) => {
			resolveSurface = resolve;
		});
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				session: {
					getMcpAppSurface: vi.fn(() => surfacePromise),
					releaseMcpAppSurface: vi.fn(async () => true),
				},
			} as unknown as DesktopApi,
		});
		render(
			<McpAppSurface
				attachment={{ id: "mcp-app-1", resourceUri: "ui://app", mimeType: "text/html;profile=mcp-app" }}
				input={{}}
			/>,
		);
		// Resolve the external IPC boundary inside act so React installs the message listener
		// before the proxy handshake is dispatched, including on slower Windows runners.
		await act(async () => {
			resolveSurface(SURFACE);
			await surfacePromise;
		});
		const frame = screen.getByTitle("mcpApp.title");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
		expect(frame.getAttribute("src")).toMatch(/^data:text\/html;base64,/);
		const target = (frame as HTMLIFrameElement).contentWindow;
		expect(target).not.toBeNull();
		const post = vi.spyOn(target as Window, "postMessage");

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://attacker.example",
				source: target,
				data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" },
			}),
		);
		expect(post).not.toHaveBeenCalled();

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: window,
				data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" },
			}),
		);
		expect(post).not.toHaveBeenCalled();

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: target,
				data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" },
			}),
		);
		expect(post).toHaveBeenCalledOnce();
		expect(post.mock.calls[0]?.[0]).toMatchObject({ method: "ui/notifications/sandbox-resource-ready" });
	});
});
