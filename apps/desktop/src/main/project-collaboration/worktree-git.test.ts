import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
	createGitWorktree,
	isRegisteredGitWorktree,
	readGitWorktreeStatus,
	removeGitWorktree,
} from "./worktree-git.js";

const exec = promisify(execFile);
const fixtures: string[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
	const options = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgSign=false"];
	return (await exec("git", [...options, ...args], { cwd, windowsHide: true })).stdout.trim();
}

async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "agent567-managed-git-")));
	fixtures.push(root);
	const source = join(root, "source");
	await mkdir(source);
	await git(source, "init", "--quiet");
	await mkdir(join(source, "project"));
	await writeFile(join(source, "project", "app.txt"), "committed\n");
	await writeFile(join(source, ".gitattributes"), "*.txt filter=fixture\n");
	await writeFile(join(source, ".gitignore"), "*.local\n");
	await git(source, "add", "--", ".gitattributes", ".gitignore", "project/app.txt");
	const head = await git(source, "commit-tree", await git(source, "write-tree"), "-m", "Initial fixture");
	await git(source, "update-ref", "HEAD", head);
	return { root, source, head };
}

it("checks out the selected commit into independent worktrees without running repository hooks or filters", async () => {
	const { root, source, head } = await fixture();
	const filter = `echo unexpected > '${join(root, "filter-ran").replaceAll("\\", "/")}'`;
	await git(source, "config", "filter.fixture.smudge", filter);
	await git(source, "config", "filter.fixture.clean", filter);
	await git(source, "config", "filter.fixture.required", "true");
	const hooks = join(source, ".git", "hooks");
	await writeFile(join(hooks, "post-checkout"), "#!/bin/sh\nprintf ran > hook-ran\n", { mode: 0o755 });
	await writeFile(join(source, "project", "app.txt"), "source dirty\n");
	const first = join(root, "trees", "first");
	const second = join(root, "trees", "second");
	await mkdir(join(root, "trees"));
	await Promise.all([createGitWorktree(source, first), createGitWorktree(join(source, "project"), second)]);

	expect(await readFile(join(first, "project", "app.txt"), "utf8")).toBe("committed\n");
	expect(await readFile(join(second, "project", "app.txt"), "utf8")).toBe("committed\n");
	expect(await readFile(join(source, "project", "app.txt"), "utf8")).toBe("source dirty\n");
	await writeFile(join(first, "project", "app.txt"), "first only\n");
	await writeFile(join(first, "ignored.local"), "private\n");
	expect(await readGitWorktreeStatus(first, source, head)).toMatchObject({
		changed: ["project/app.txt", "ignored.local"],
	});
	expect(await readGitWorktreeStatus(second, source, head)).toMatchObject({ changed: [], hasUniqueCommits: false });
	await expect(access(join(root, "filter-ran"))).rejects.toMatchObject({ code: "ENOENT" });
	await expect(access(join(first, "hook-ran"))).rejects.toMatchObject({ code: "ENOENT" });
	await expect(access(join(second, "hook-ran"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await isRegisteredGitWorktree(source, second)).toBe(true);
	await removeGitWorktree(source, second);
	expect(await isRegisteredGitWorktree(source, second)).toBe(false);
	await expect(removeGitWorktree(source, first)).rejects.toThrow();
	expect(await readFile(join(first, "project", "app.txt"), "utf8")).toBe("first only\n");
});

it("detects a commit reachable only from the detached worktree", async () => {
	const { root, source, head } = await fixture();
	const target = join(root, "tree");
	await createGitWorktree(source, target);
	const unique = await git(target, "commit-tree", await git(target, "write-tree"), "-p", head, "-m", "Only here");
	await git(target, "update-ref", "HEAD", unique);
	expect(await readGitWorktreeStatus(target, source, head)).toMatchObject({ changed: [], hasUniqueCommits: true });
	await git(source, "update-ref", "refs/heads/saved", unique);
	expect(await readGitWorktreeStatus(target, source, head)).toMatchObject({ changed: [], hasUniqueCommits: false });
});

it.each(["--assume-unchanged", "--skip-worktree"])("protects changes hidden by %s", async (flag) => {
	const { root, source, head } = await fixture();
	const target = join(root, "tree");
	await createGitWorktree(source, target);
	await git(target, "update-index", flag, "project/app.txt");
	await writeFile(join(target, "project", "app.txt"), "hidden changes\n");
	expect(await readGitWorktreeStatus(target, source, head)).toMatchObject({ changed: ["project/app.txt"] });
});
