import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repoRoot } from "./lib.mjs";
import { withTestReport } from "./vitest-report-args.mjs";

it("keeps local and caller supplied reporters unchanged", () => {
	expect(withTestReport(["--run"], {}, "/repo")).toEqual(["--run"]);
	expect(withTestReport(["--reporter=json"], { AGENT567_TEST_REPORTS: "1" }, "/repo")).toEqual(["--reporter=json"]);
	expect(withTestReport(["--run"], { AGENT567_TEST_REPORTS: "1" }, "/repo", "case")).toContain(
		`--outputFile.junit=${join("/repo", ".test-reports/case.xml")}`,
	);
});

it("the real wrapper writes a failing test report and preserves its nonzero exit", () => {
	const root = mkdtempSync(join(repoRoot, ".tmp-report-"));
	try {
		writeFileSync(
			join(root, "vitest.config.mjs"),
			'export default {test:{include:["case.test.mjs"],pool:"forks",maxWorkers:1,fileParallelism:false}};',
		);
		writeFileSync(
			join(root, "case.test.mjs"),
			'import {test,expect} from "vitest";test("intentional-report-fixture",()=>expect(1).toBe(2));',
		);
		const result = spawnSync(
			process.execPath,
			[join(repoRoot, "scripts/quality/run-vitest.mjs"), "--run", "--config", "vitest.config.mjs"],
			{
				cwd: root,
				env: { ...process.env, AGENT567_TEST_REPORTS: "1" },
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		const reports = readdirSync(join(root, ".test-reports"));
		expect(reports).toHaveLength(1);
		const xml = readFileSync(join(root, ".test-reports", reports[0]), "utf8");
		expect(xml).toContain("intentional-report-fixture");
		expect(xml).toContain("<failure");
	} finally {
		rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}, 40_000);
