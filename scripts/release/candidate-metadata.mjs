import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopVersion, releaseNotesPath } from "./release-notes.mjs";
import { lockfileDesktopVersion, mobileVersionCode } from "./release-version.mjs";

export function countSections(text) {
	const counts = {};
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		const heading = /^## (.+)$/.exec(line);
		if (heading) {
			current = heading[1].trim();
			counts[current] = 0;
		} else if (current && /^- \S/.test(line)) counts[current] += 1;
	}
	return counts;
}

/** Offline checks shared by ordinary candidate CI and the final release gate. */
export function candidateMetadataProblems({ version, lockVersion, mobileVersion, mobileCode, notes }) {
	const problems = [];
	if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`Invalid desktop version: ${version}`);
	if (lockVersion !== version)
		problems.push(`bun.lock 里桌面端版本是 ${lockVersion ?? "（没找到）"}，应为 ${version}`);
	try {
		const code = mobileVersionCode(version);
		if (mobileVersion !== version || mobileCode !== code) problems.push(`Android 版本必须为 ${version}/${code}`);
	} catch {
		problems.push("Version cannot be represented as an Android versionCode");
	}
	if (!notes) problems.push(`缺少发布说明 ${releaseNotesPath(version)}`);
	else {
		const title = /^# 567 Agent (.+)$/m.exec(notes)?.[1]?.trim();
		if (title !== version)
			problems.push(`发布说明标题是「# 567 Agent ${title ?? "?"}」，应为「# 567 Agent ${version}」`);
		if (!Object.values(countSections(notes)).some((count) => count > 0)) problems.push("发布说明没有任何条目");
		if (/\b(TODO|TBD|FIXME)\b|待补|待填|占位/.test(notes))
			problems.push("发布说明里还有占位文字（TODO / TBD / 待补…）");
	}
	return problems;
}

export function checkCandidateMetadata(root) {
	const version = desktopVersion(root);
	const mobile = readFileSync(join(root, "apps/mobile/version.properties"), "utf8");
	const problems = candidateMetadataProblems({
		version,
		lockVersion: lockfileDesktopVersion(readFileSync(join(root, "bun.lock"), "utf8")),
		mobileVersion: /^versionName=(.+)$/m.exec(mobile)?.[1]?.trim(),
		mobileCode: Number(/^versionCode=(\d+)\r?$/m.exec(mobile)?.[1]),
		notes: readFileSync(join(root, releaseNotesPath(version)), "utf8"),
	});
	if (problems.length) throw new Error(problems.join("\n"));
	return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const root = process.argv.includes("--root")
			? process.argv[process.argv.indexOf("--root") + 1]
			: fileURLToPath(new URL("../../", import.meta.url));
		console.log(`[candidate-metadata] ${checkCandidateMetadata(root)} ok`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
