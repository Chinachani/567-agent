/**
 * Desktop production staging layout.
 *
 * The pack step copies build output to these top-level directories inside the
 * Electron app archive. Runtime code in packaged mode must resolve resources
 * relative to this layout, not the development dist/ directory.
 */
export const DESKTOP_BUILD_OUTPUTS = Object.freeze([
	{ source: "dist/main", target: "main" },
	{ source: "dist/preload", target: "preload" },
	{ source: "dist/renderer", target: "renderer" },
	{ source: "dist/ocr-preload", target: "ocr-preload" },
	{ source: "dist/ocr-runner", target: "ocr-runner" },
]);

export const VETTA_PLUGIN_FILE_ASSOCIATION = Object.freeze({
	ext: "vettapkg",
	name: "Vetta Plugin Package",
	description: "Installable Vetta plugin package",
	mimeType: "application/vnd.vetta.plugin+zip",
	role: "Editor",
});

export const VETTA_DESIGN_SHARE_FILE_ASSOCIATION = Object.freeze({
	ext: "567design",
	name: "567 Agent Design Share Package",
	description: "567 Agent 设计分享包",
	mimeType: "application/vnd.567agent.design+zip",
	role: "Editor",
});

export const DESKTOP_REQUIRED_SOURCE_FILES = Object.freeze([
	"src/main/main.ts",
	"src/preload/index.ts",
	"src/preload/remote-desktop.ts",
	"src/renderer/index.html",
	"src/renderer/remote-desktop-host.html",
]);
