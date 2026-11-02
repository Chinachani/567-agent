import { describe, expect, it } from "vitest";
import { countSections, evaluatePreflight } from "./release-preflight.mjs";
import { mobileVersionCode } from "./release-version.mjs";

const NOTES = "# 567 Agent 0.5.70\n<!-- release-status: unreleased -->\n\n## 新增\n\n- 一\n- 二\n\n## 修复\n\n- 三\n";

/** 一份能通过的事实，各用例只改要测的那一项。 */
const facts = (overrides = {}) => ({
	tag: "v0.5.70",
	packageVersion: "0.5.70",
	lockVersion: "0.5.70",
	notes: NOTES,
	localTagExists: false,
	remoteTagExists: false,
	githubReleaseExists: false,
	latestReleased: "0.5.69",
	allowIrregular: false,
	branch: "main",
	mainMatches: true,
	mobileVersion: (overrides.tag ?? "v0.5.70").replace(/^v/, ""),
	mobileCode: mobileVersionCode((overrides.tag ?? "v0.5.70").replace(/^v/, "")),
	dirty: "",
	head: "abc1234 chore(release): 合并 dev 发布 v0.5.70",
	commitCount: 12,
	pluginChanges: ["vetta-ui-design 0.7.6 → 0.7.8"],
	...overrides,
});

describe("release preflight", () => {
	it("passes a consistent release and prints the confirmation summary", () => {
		const { problems, warnings, summary } = evaluatePreflight(facts());
		expect(problems).toEqual([]);
		expect(warnings).toEqual([]);
		expect(summary.join("\n")).toContain("将发布 v0.5.70（修订号升级，上一个版本 v0.5.69）");
		expect(summary.join("\n")).toContain("新增 2 条 / 修复 1 条");
		expect(summary.join("\n")).toContain("vetta-ui-design 0.7.6 → 0.7.8");
	});

	// desktop-release 对版本号不符的 tag 只会静默跳过，这一项必须在推 tag 前拦住。
	it("blocks a tag that does not match the package, lockfile or notes", () => {
		const { problems } = evaluatePreflight(
			facts({ packageVersion: "0.5.69", lockVersion: "0.5.69", notes: NOTES.replace("# 567 Agent 0.5.70", "# 567 Agent 0.5.69") }),
		);
		expect(problems.join("\n")).toMatch(/package\.json 是 0\.5\.69.*拒绝构建/);
		expect(problems.join("\n")).toMatch(/bun\.lock 里桌面端版本是 0\.5\.69/);
		expect(problems.join("\n")).toMatch(/标题是「# 567 Agent 0\.5\.69」/);
	});

	it("blocks a version that was already released anywhere", () => {
		const { problems } = evaluatePreflight(
			facts({
				localTagExists: true,
				remoteTagExists: true,
				githubReleaseExists: true,
				notes: NOTES.replace("unreleased", "released 2026-10-29"),
			}),
		);
		expect(problems).toHaveLength(4);
	});

	it("refuses to guess when GitHub or remote tags cannot be queried", () => {
		expect(evaluatePreflight(facts({ githubReleaseExists: null })).problems.join()).toMatch(/无法查询 GitHub Release/);
		expect(evaluatePreflight(facts({ remoteTagExists: null })).problems.join()).toMatch(/无法查询远端 tag/);
	});

	it("accepts patch, minor and major steps, holds back skips until confirmed", () => {
		expect(evaluatePreflight(facts({ tag: "v0.6.0", packageVersion: "0.6.0", lockVersion: "0.6.0", notes: NOTES.replace("0.5.70", "0.6.0") })).problems).toEqual([]);
		const skipped = facts({ tag: "v0.5.72", packageVersion: "0.5.72", lockVersion: "0.5.72", notes: NOTES.replace("0.5.70", "0.5.72") });
		expect(evaluatePreflight(skipped).problems.join()).toMatch(/跳了号.*--allow-irregular/);
		expect(evaluatePreflight({ ...skipped, allowIrregular: true }).problems).toEqual([]);
		expect(evaluatePreflight(facts({ latestReleased: "0.5.70" })).problems.join()).toMatch(/不比最近一个已发布的 v0\.5\.70 大/);
	});

	it("requires the pushed main candidate and a clean worktree", () => {
		const { problems } = evaluatePreflight(facts({ branch: "dev", mainMatches: false, dirty: " M bun.lock" }));
		expect(problems).toHaveLength(3);
	});

	it("requires Android and Desktop to agree before invoking candidate CI checks", () => {
		expect(evaluatePreflight(facts({ mobileVersion: "0.5.69", mobileCode: 569 })).problems.join()).toMatch(/Android 版本/);
	});

	it("requires release notes with entries and no placeholders", () => {
		const empty = "# 567 Agent 0.5.70\n<!-- release-status: unreleased -->\n";
		expect(evaluatePreflight(facts({ notes: empty })).problems.join()).toMatch(/没有任何条目/);
		expect(evaluatePreflight(facts({ notes: `${NOTES}- TODO 补一条\n` })).problems.join()).toMatch(/占位文字/);
		expect(evaluatePreflight(facts({ notes: null })).problems.join()).toMatch(/缺少发布说明/);
	});

	it("counts entries per section", () => {
		expect(countSections(NOTES)).toEqual({ 新增: 2, 修复: 1 });
	});
});
