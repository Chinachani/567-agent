import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** Opt-in in CI, one file per invocation; never override a caller's reporters. */
export function withTestReport(args, env, cwd, id = randomUUID()) {
	if (env.AGENT567_TEST_REPORTS !== "1" || args.some((arg) => /^--(?:reporter|outputFile)(?:[.=]|$)/.test(arg)))
		return args;
	return [
		...args,
		"--reporter=default",
		"--reporter=junit",
		`--outputFile.junit=${join(cwd, ".test-reports", `${id}.xml`)}`,
	];
}
