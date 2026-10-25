import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryEntry } from "@567agent/runtime-core";
import { afterEach, expect, it, vi } from "vitest";

const decoder = vi.hoisted(() => ({ create: vi.fn(), resize: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: decoder.create } }));

import { attachmentThumbnail } from "./attachment-thumbnail.js";
import { SessionWorkbench } from "./session-workbench.js";

let root: string;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	vi.clearAllMocks();
});
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=",
	"base64",
);
function nativeDecoder() {
	decoder.resize.mockReturnValue({ toPNG: () => png });
	decoder.create.mockReturnValue({ isEmpty: () => false, resize: decoder.resize });
}
it("lists explicitly attached images, previews them, reads originals and reports a later missing file", async () => {
	root = await mkdtemp(join(tmpdir(), "agent567-workbench-"));
	const cwd = join(root, "project");
	await mkdir(cwd);
	const path = join(root, "attached.png");
	await writeFile(path, png);
	const history: HistoryEntry[] = [
		{ type: "prompt_attachments_marker", attachments: [{ kind: "image", path }], timestamp: "2026-10-22" },
	];
	nativeDecoder();
	const service = new SessionWorkbench(
		join(root, "session.json"),
		cwd,
		() => history,
		() => false,
	);
	const file = (await service.read()).attachments[0]!;
	const detail = await service.detail("attachment", file.id);
	expect(detail.thumbnailDataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
	expect(Buffer.from((await service.chunk(file.id, 0, 1024)).dataBase64, "base64")).toEqual(png);
	await expect(service.detail("attachment", path)).rejects.toThrow("no longer exists");
	await rm(path);
	expect((await service.detail("attachment", file.id)).previewStatus).toBe("unavailable");
});
it("rejects retargeted external aliases and skips oversized previews without disabling original transfer", async () => {
	root = await mkdtemp(join(tmpdir(), "agent567-workbench-"));
	const cwd = join(root, "project");
	await mkdir(cwd);
	const secret = join(root, "private.png");
	await writeFile(secret, png);
	const alias = join(root, "alias.png");
	await symlink(secret, alias);
	const large = join(cwd, "large.png");
	await writeFile(large, Buffer.alloc(4 * 1024 * 1024 + 1));
	const history: HistoryEntry[] = [
		{
			type: "prompt_attachments_marker",
			attachments: [
				{ kind: "image", path: alias },
				{ kind: "image", path: large },
			],
			timestamp: "2026-10-22",
		},
	];
	const service = new SessionWorkbench(
		join(root, "session.json"),
		cwd,
		() => history,
		() => false,
	);
	const files = (await service.read()).attachments;
	expect((await service.detail("attachment", files[0]!.id)).previewStatus).toBe("unavailable");
	const detail = await service.detail("attachment", files[1]!.id);
	expect(detail.thumbnailDataUrl).toBeUndefined();
	expect(detail.previewStatus).toBe("binary");
	expect((await service.chunk(files[1]!.id, 0, 1)).sizeBytes).toBe(4 * 1024 * 1024 + 1);
	expect(decoder.create).not.toHaveBeenCalled();
});
it("rejects active formats and excessive pixel counts before invoking the native decoder", async () => {
	nativeDecoder();
	expect(await attachmentThumbnail(Buffer.from('<svg width="100" height="100"><script/></svg>'))).toBeUndefined();
	const bomb = Buffer.from(png);
	bomb.writeUInt32BE(100000, 16);
	bomb.writeUInt32BE(100000, 20);
	expect(await attachmentThumbnail(bomb)).toBeUndefined();
	expect(decoder.create).not.toHaveBeenCalled();
	expect(await attachmentThumbnail(png)).toContain("data:image/png;base64,");
	expect(decoder.resize).toHaveBeenCalledWith({ width: 1, height: 1 });
});
