import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { StoredSessionEvent } from "@567agent/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { TurnFileCheckpoints } from "./turn-file-checkpoints.js";

const run = promisify(execFile);
const sessionId = "session-checkpoints";
const signal = new AbortController().signal;
const roots = new Set<string>();

afterEach(async () => {
	await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
	roots.clear();
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	await run("git", args, { cwd, windowsHide: true });
}

async function createFixture(): Promise<{ readonly cwd: string; readonly storePath: string; readonly root: string }> {
	const root = await mkdtemp(join(tmpdir(), "agent567-turn-file-checkpoints-"));
	roots.add(root);
	const cwd = join(root, "repository");
	await mkdir(cwd);
	await git(cwd, "init", "--quiet");
	return { cwd, root, storePath: join(root, "state", "checkpoints.json") };
}

async function writeRepositoryFile(cwd: string, path: string, content: string): Promise<void> {
	const target = join(cwd, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, content);
}

function started(turnId: string, timestamp: number): StoredSessionEvent {
	return {
		type: "turn.started",
		sessionId,
		turnId,
		snapshotId: `snapshot-${turnId}`,
		timestamp,
	};
}

function userMessage(turnId: string, content: string, timestamp: number): StoredSessionEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId,
		message: { role: "user", content, timestamp },
		timestamp,
	};
}

function completed(turnId: string, timestamp: number): StoredSessionEvent {
	return {
		type: "turn.completed",
		sessionId,
		turnId,
		stopReason: "stop",
		timestamp,
	};
}

async function beginTurn(checkpoints: TurnFileCheckpoints, turnId: string, timestamp: number): Promise<void> {
	await checkpoints.observe(started(turnId, timestamp), signal);
	await checkpoints.observe(userMessage(turnId, "Update project files", timestamp + 1), signal);
}

async function finishTurn(checkpoints: TurnFileCheckpoints, turnId: string, timestamp: number): Promise<void> {
	await checkpoints.observe(completed(turnId, timestamp), signal);
}

describe("TurnFileCheckpoints", () => {
	it("discards overlapping captures so one session cannot restore another session's changes", async () => {
		const { cwd, root, storePath } = await createFixture();
		const first = new TurnFileCheckpoints(storePath, cwd, () => false);
		const second = new TurnFileCheckpoints(join(root, "other-checkpoints.json"), cwd, () => false);
		await beginTurn(first, "first", 100);
		await writeRepositoryFile(cwd, "first.txt", "first session\n");
		await beginTurn(second, "second", 102);
		await writeRepositoryFile(cwd, "second.txt", "second session\n");
		await finishTurn(first, "first", 104);
		await finishTurn(second, "second", 105);
		expect(await first.list()).toEqual([]);
		expect(await second.list()).toEqual([]);
	});

	it("restores pre-turn dirty content after repeated writes, additions and deletions survive a fresh instance", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "dirty.txt", "baseline\n");
		await writeRepositoryFile(cwd, "deleted.txt", "keep after restore\n");
		await git(cwd, "add", "--all");
		await writeRepositoryFile(cwd, "dirty.txt", "dirty before turn\n");

		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-main", 100);
		await writeRepositoryFile(cwd, "dirty.txt", "agent intermediate\n");
		await writeRepositoryFile(cwd, "dirty.txt", "agent final\n");
		await writeRepositoryFile(cwd, "added.txt", "created by agent\n");
		await rm(join(cwd, "deleted.txt"));
		await finishTurn(checkpoints, "turn-main", 110);

		const reopened = new TurnFileCheckpoints(storePath, cwd, () => false);
		expect(await reopened.list()).toEqual([
			{
				turnId: "turn-main",
				title: "Update project files",
				timestamp: 100,
				fileCount: 3,
			},
		]);

		const preview = await reopened.preview("turn-main");
		expect(Object.fromEntries(preview.files.map((file) => [file.path, file]))).toMatchObject({
			"added.txt": { change: "added", status: "ready" },
			"deleted.txt": { change: "deleted", status: "ready" },
			"dirty.txt": { change: "modified", status: "ready" },
		});

		const restored = await reopened.restore(preview.previewId);
		expect(restored.every((file) => file.status === "restored")).toBe(true);
		expect(await readFile(join(cwd, "dirty.txt"), "utf8")).toBe("dirty before turn\n");
		expect(await readFile(join(cwd, "deleted.txt"), "utf8")).toBe("keep after restore\n");
		await expect(access(join(cwd, "added.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("requires the exact current preview token and consumes it after a successful restore", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "file.txt", "before\n");
		await git(cwd, "add", "--all");

		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-token", 200);
		await writeRepositoryFile(cwd, "file.txt", "after\n");
		await finishTurn(checkpoints, "turn-token", 210);

		const preview = await checkpoints.preview("turn-token");
		expect(preview.files).toEqual([{ path: "file.txt", change: "modified", status: "ready" }]);
		await expect(checkpoints.restore("different-preview")).rejects.toThrow(
			"Refresh the turn file preview before restoring",
		);
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after\n");

		expect(await checkpoints.restore(preview.previewId)).toEqual([
			{ path: "file.txt", change: "modified", status: "restored" },
		]);
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("before\n");
		await expect(checkpoints.restore(preview.previewId)).rejects.toThrow(
			"Refresh the turn file preview before restoring",
		);
	});

	it("recreates directories removed during the turn and preserves directories removed after it", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "during/deep/file.txt", "restore me");
		await writeRepositoryFile(cwd, "later/file.txt", "external removal must stay");
		await git(cwd, "add", "--", "during/deep/file.txt", "later/file.txt");
		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-directories", 250);
		await rm(join(cwd, "during"), { recursive: true });
		await unlink(join(cwd, "later", "file.txt"));
		await finishTurn(checkpoints, "turn-directories", 260);
		await rm(join(cwd, "later"), { recursive: true });

		const preview = await checkpoints.preview("turn-directories");
		expect(preview.files).toEqual([
			{ path: "during/deep/file.txt", change: "deleted", status: "ready" },
			{ path: "later/file.txt", change: "deleted", status: "unavailable" },
		]);
		await checkpoints.restore(preview.previewId);
		expect(await readFile(join(cwd, "during", "deep", "file.txt"), "utf8")).toBe("restore me");
		await expect(access(join(cwd, "later"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("preserves a file changed after preview while restoring the remaining ready files", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "a.txt", "a before\n");
		await writeRepositoryFile(cwd, "b.txt", "b before\n");
		await git(cwd, "add", "--all");

		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-conflict", 300);
		await writeRepositoryFile(cwd, "a.txt", "a after\n");
		await writeRepositoryFile(cwd, "b.txt", "b after\n");
		await finishTurn(checkpoints, "turn-conflict", 310);

		const preview = await checkpoints.preview("turn-conflict");
		expect(preview.files.every((file) => file.status === "ready")).toBe(true);
		await writeRepositoryFile(cwd, "a.txt", "changed outside checkpoint\n");

		const results = await checkpoints.restore(preview.previewId);
		expect(Object.fromEntries(results.map((file) => [file.path, file.status]))).toEqual({
			"a.txt": "conflict",
			"b.txt": "restored",
		});
		expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("changed outside checkpoint\n");
		expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("b before\n");
	});

	it("reports unavailable files without writing while the session is busy", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "file.txt", "before\n");
		await git(cwd, "add", "--all");

		let busy = false;
		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => busy);
		await beginTurn(checkpoints, "turn-busy", 400);
		await writeRepositoryFile(cwd, "file.txt", "after\n");
		await finishTurn(checkpoints, "turn-busy", 410);

		busy = true;
		const unavailable = await checkpoints.preview("turn-busy");
		expect(unavailable.files).toEqual([{ path: "file.txt", change: "modified", status: "unavailable" }]);
		await expect(checkpoints.restore(unavailable.previewId)).rejects.toThrow(
			"Refresh the turn file preview before restoring",
		);
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after\n");

		busy = false;
		const ready = await checkpoints.preview("turn-busy");
		expect(ready.files).toEqual([{ path: "file.txt", change: "modified", status: "ready" }]);
		busy = true;
		await expect(checkpoints.restore(ready.previewId)).rejects.toThrow(
			"Wait for the active task before restoring files",
		);
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after\n");
	});

	it("does not restore a checkpoint against a different workspace", async () => {
		const { cwd, root, storePath } = await createFixture();
		await writeRepositoryFile(cwd, "file.txt", "workspace a before\n");
		await git(cwd, "add", "--all");

		const source = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(source, "turn-other-workspace", 500);
		await writeRepositoryFile(cwd, "file.txt", "workspace a after\n");
		await finishTurn(source, "turn-other-workspace", 510);

		const otherCwd = join(root, "other-repository");
		await mkdir(otherCwd);
		await git(otherCwd, "init", "--quiet");
		await writeRepositoryFile(otherCwd, "file.txt", "workspace b stays\n");
		await git(otherCwd, "add", "--all");

		const other = new TurnFileCheckpoints(storePath, otherCwd, () => false);
		const preview = await other.preview("turn-other-workspace");
		expect(preview.files).toEqual([{ path: "file.txt", change: "modified", status: "unavailable" }]);
		await expect(other.restore(preview.previewId)).rejects.toThrow("Refresh the turn file preview before restoring");
		expect(await readFile(join(otherCwd, "file.txt"), "utf8")).toBe("workspace b stays\n");
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("workspace a after\n");
	});

	it("leaves ignored files changed during the turn outside the restore set", async () => {
		const { cwd, storePath } = await createFixture();
		await writeRepositoryFile(cwd, ".gitignore", "ignored.txt\n");
		await writeRepositoryFile(cwd, "tracked.txt", "tracked before\n");
		await writeRepositoryFile(cwd, "ignored.txt", "ignored before\n");
		await git(cwd, "add", "--all");

		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-ignored", 600);
		await writeRepositoryFile(cwd, "tracked.txt", "tracked after\n");
		await writeRepositoryFile(cwd, "ignored.txt", "ignored after\n");
		await finishTurn(checkpoints, "turn-ignored", 610);

		expect(await checkpoints.list()).toEqual([
			{
				turnId: "turn-ignored",
				title: "Update project files",
				timestamp: 600,
				fileCount: 1,
			},
		]);
		const preview = await checkpoints.preview("turn-ignored");
		expect(preview.files.map((file) => file.path)).toEqual(["tracked.txt"]);
		await checkpoints.restore(preview.previewId);
		expect(await readFile(join(cwd, "tracked.txt"), "utf8")).toBe("tracked before\n");
		expect(await readFile(join(cwd, "ignored.txt"), "utf8")).toBe("ignored after\n");
	});

	it("treats a tracked symlink that becomes a file as unavailable and never writes through it", async (context) => {
		const { cwd, root, storePath } = await createFixture();
		const outside = join(root, "outside.txt");
		const alias = join(cwd, "alias.txt");
		await writeFile(outside, "outside stays unchanged\n");
		try {
			await symlink(outside, alias);
		} catch (error) {
			if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) {
				context.skip("This platform does not permit symlink fixtures");
				return;
			}
			throw error;
		}
		await git(cwd, "add", "--all");

		const checkpoints = new TurnFileCheckpoints(storePath, cwd, () => false);
		await beginTurn(checkpoints, "turn-symlink", 700);
		await unlink(alias);
		await writeFile(alias, "agent-created regular file\n");
		await finishTurn(checkpoints, "turn-symlink", 710);

		const preview = await checkpoints.preview("turn-symlink");
		expect(preview.files).toEqual([{ path: "alias.txt", change: "unsupported", status: "unavailable" }]);
		expect(await checkpoints.restore(preview.previewId)).toEqual([
			{ path: "alias.txt", change: "unsupported", status: "unavailable" },
		]);
		expect(await readFile(alias, "utf8")).toBe("agent-created regular file\n");
		expect(await readFile(outside, "utf8")).toBe("outside stays unchanged\n");
	});
});
