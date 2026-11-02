#!/usr/bin/env node

/**
 * 打 tag 之前的最后一道闸：在合并好的 main 上运行，确认要发的就是想发的那一版。
 *
 * 推 tag 前复用离线元数据校验与同 SHA CI 准入。版本不符的 tag 会在流水线早期失败。
 *
 * 检查规则是纯函数（evaluatePreflight），git / gh 的事实由 collectFacts 收集，
 * 测试只喂事实、不碰真实仓库。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopVersion, parseReleaseStatus, releaseNotesPath } from "./release-notes.mjs";
import { classifyBump, latestReleasedVersion, lockfileDesktopVersion } from "./release-version.mjs";
import { candidateMetadataProblems, countSections } from "./candidate-metadata.mjs";
export { countSections } from "./candidate-metadata.mjs";
import { requireReleasePreflight } from "./require-release-preflight.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * @param {object} facts
 * @returns {{ problems: string[], warnings: string[], summary: string[] }}
 */
export function evaluatePreflight(facts) {
	const problems = [];
	const warnings = [];
	const version = facts.tag.replace(/^v/, "");

	// 1. 版本号处处一致
	if (!/^v\d+\.\d+\.\d+$/.test(facts.tag)) problems.push(`tag 必须是 v<major>.<minor>.<patch>，收到 ${facts.tag}`);
	if (facts.packageVersion !== version) {
		problems.push(
			`apps/desktop/package.json 是 ${facts.packageVersion}，要打的 tag 是 ${facts.tag}（流水线会拒绝构建）`,
		);
	}
	problems.push(
		...candidateMetadataProblems({
			version,
			lockVersion: facts.lockVersion,
			mobileVersion: facts.mobileVersion,
			mobileCode: facts.mobileCode,
			notes: facts.notes,
		}),
	);

	// 2. 还没发过
	if (facts.localTagExists) problems.push(`本地已有 tag ${facts.tag}`);
	if (facts.remoteTagExists) problems.push(`远端已有 tag ${facts.tag}`);
	if (facts.githubReleaseExists) problems.push(`GitHub 上已有 Release ${facts.tag}`);
	if (facts.githubReleaseExists === null) problems.push("无法查询 GitHub Release，必须联网确认尚未发布");
	if (facts.remoteTagExists === null) problems.push("无法查询远端 tag，必须联网确认标签不存在");
	const status = facts.notes ? parseReleaseStatus(facts.notes) : null;
	if (status && status.state !== "unreleased") {
		problems.push(
			`发布说明标着 ${status.state === "released" ? `已于 ${status.date} 发布` : "无状态（按已发布处理）"}`,
		);
	}

	// 3. 比上一个已发布版本大，且没有跳号
	const bump = classifyBump(facts.latestReleased, version);
	if (bump === "invalid") problems.push(`${facts.tag} 不比最近一个已发布的 v${facts.latestReleased} 大`);
	if (bump === "irregular") {
		const message = `v${facts.latestReleased} → ${facts.tag} 跳了号或没有归零`;
		if (facts.allowIrregular) warnings.push(`${message}（已用 --allow-irregular 确认）`);
		else problems.push(`${message}；确认是有意的，加 --allow-irregular`);
	}

	// 4. 候选必须已推到本仓库 main；CI 准入随后复用官方同 SHA 检查。
	if (facts.branch !== "main")
		problems.push(`当前分支是 ${facts.branch || "（游离 HEAD）"}，应在合并好的 main 上运行`);
	if (!facts.mainMatches) problems.push("本地候选与远端 main 不一致或远端不可查询，请先推送候选并等待同 SHA 检查");
	if (facts.dirty) problems.push(`工作区有未提交的改动：\n${facts.dirty}`);

	// 5. 发布说明有内容
	const sections = facts.notes ? countSections(facts.notes) : {};

	const sectionText = Object.entries(sections)
		.filter(([, n]) => n > 0)
		.map(([name, n]) => `${name} ${n} 条`)
		.join(" / ");
	const bumpText = {
		patch: "修订号升级",
		minor: "次版本号升级",
		major: "主版本号升级",
		irregular: "跳号",
		invalid: "版本倒退",
	}[bump];
	const summary = [
		`将发布 ${facts.tag}（${bumpText}，上一个版本 ${facts.latestReleased ? `v${facts.latestReleased}` : "无"}）`,
		`  tag 指向：${facts.head}`,
		`  包含提交：${facts.commitCount} 个`,
		`  发布说明：${sectionText || "（空）"}`,
		...(facts.pluginChanges.length > 0 ? [`  插件版本：${facts.pluginChanges.join("，")}`] : []),
	];
	return { problems, warnings, summary };
}

function git(root, args, allowFail = false) {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch (error) {
		if (allowFail) return null;
		throw error;
	}
}

function pluginChanges(root, previousTag) {
	if (!previousTag) return [];
	const files = git(root, ["ls-files", "packages/plugins/presets/*/plugin.json"]).split(/\r?\n/).filter(Boolean);
	const changes = [];
	for (const file of files) {
		const now = JSON.parse(readFileSync(join(root, file), "utf8"));
		const before = git(root, ["show", `${previousTag}:${file}`], true);
		const was = before ? JSON.parse(before).version : null;
		if (was !== now.version) changes.push(`${now.id ?? file} ${was ?? "新增"} → ${now.version}`);
	}
	return changes;
}

export function collectFacts({ root = repositoryRoot, tag, allowIrregular = false }) {
	const packageVersion = desktopVersion(root);
	const resolvedTag = tag ?? `v${packageVersion}`;
	const version = resolvedTag.replace(/^v/, "");
	const notesFile = join(root, releaseNotesPath(/^\d+\.\d+\.\d+$/.test(version) ? version : packageVersion));
	const tags = git(root, ["tag", "--list", "v*"]).split(/\r?\n/).filter(Boolean);
	const latestReleased = latestReleasedVersion(tags.filter((t) => t !== resolvedTag));
	let githubReleaseExists = null;
	try {
		execFileSync("gh", ["release", "view", resolvedTag, "--json", "tagName"], { cwd: root, stdio: "pipe" });
		githubReleaseExists = true;
	} catch (error) {
		const stderr = String(error?.stderr ?? "");
		githubReleaseExists = /release not found|not found/i.test(stderr) ? false : null;
	}
	const head = git(root, ["rev-parse", "HEAD"]);
	const remoteMain = git(root, ["ls-remote", "--heads", "origin", "refs/heads/main"], true);
	const remoteTag = git(root, ["ls-remote", "--tags", "origin", `refs/tags/${resolvedTag}`], true);
	const mobile = readFileSync(join(root, "apps/mobile/version.properties"), "utf8");
	return {
		tag: resolvedTag,
		packageVersion,
		lockVersion: lockfileDesktopVersion(readFileSync(join(root, "bun.lock"), "utf8")),
		notes: existsSync(notesFile) ? readFileSync(notesFile, "utf8") : null,
		localTagExists: tags.includes(resolvedTag),
		remoteTagExists: remoteTag === null ? null : Boolean(remoteTag),
		githubReleaseExists,
		latestReleased,
		allowIrregular,
		branch: git(root, ["branch", "--show-current"]),
		mainMatches: remoteMain?.split(/\s/)[0] === head,
		mobileVersion: /^versionName=(.+)$/m.exec(mobile)?.[1]?.trim(),
		mobileCode: Number(/^versionCode=(\d+)$/m.exec(mobile)?.[1]),
		dirty: git(root, ["status", "--porcelain"]),
		head,
		commitCount: Number(
			git(
				root,
				["rev-list", "--count", "--no-merges", latestReleased ? `v${latestReleased}..HEAD` : "HEAD"],
				true,
			) ?? 0,
		),
		pluginChanges: pluginChanges(root, latestReleased ? `v${latestReleased}` : null),
	};
}

async function main(argv) {
	const tagIndex = argv.indexOf("--tag");
	const tag = tagIndex === -1 ? undefined : argv[tagIndex + 1];
	const facts = collectFacts({ tag, allowIrregular: argv.includes("--allow-irregular") });
	const { problems, warnings, summary } = evaluatePreflight(facts);
	for (const line of summary) console.log(line);
	for (const warning of warnings) console.log(`注意：${warning}`);
	if (problems.length > 0) {
		console.error(`\n预检没通过，不要打 tag：\n- ${problems.join("\n- ")}`);
		process.exit(1);
	}
	const token =
		process.env.GH_TOKEN ??
		process.env.GITHUB_TOKEN ??
		execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	await requireReleasePreflight({ repository: "Chinachani/567-agent", sha: facts.head, token });
	console.log("\n版本、远端候选与同 SHA CI 预检通过。");
}

function isExecutedDirectly() {
	const invoked = process.argv[1];
	if (!invoked) return false;
	return fileURLToPath(import.meta.url).toLowerCase() === resolve(invoked).toLowerCase();
}

if (isExecutedDirectly()) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
