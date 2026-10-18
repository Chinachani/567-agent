import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOWS = ["quality.yml", "desktop-packaged.yml"];

/** Admit the exact candidate only after its main checks, never a green ancestor or PR merge view. */
export async function requireReleasePreflight({ repository, sha, token, maxWaitMs = 0, intervalMs = 30_000 }) {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "")) {
		throw new Error("Release preflight requires an owner/repository and a complete commit SHA.");
	}
	if (!token) throw new Error("Release preflight requires a GitHub token with actions:read.");
	const deadline = Date.now() + maxWaitMs;
	let previousStatus;
	while (true) {
		const checks = await Promise.all(
			WORKFLOWS.map(async (workflow) => {
				const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`);
				url.searchParams.set("head_sha", sha);
				url.searchParams.set("per_page", "100");
				const response = await fetch(url, {
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
					},
					signal: AbortSignal.timeout(30_000),
				});
				if (!response.ok) throw new Error(`Cannot inspect ${workflow}: GitHub HTTP ${response.status}.`);
				const body = await response.json();
				if (!Array.isArray(body.workflow_runs)) throw new Error(`Invalid GitHub response for ${workflow}.`);
				const run = body.workflow_runs
					.filter(
						(item) =>
							item.head_sha === sha &&
							((item.event === "push" && item.head_branch === "main") || item.event === "workflow_dispatch"),
					)
					.sort((left, right) => right.run_number - left.run_number || right.run_attempt - left.run_attempt)[0];
				return {
					workflow,
					state: !run ? "missing" : run.status === "completed" ? run.conclusion : run.status,
					url: run?.html_url,
					finished: run?.status === "completed",
				};
			}),
		);
		const status = checks
			.map((check) => `${check.workflow}: ${check.state}${check.url ? ` (${check.url})` : ""}`)
			.join("\n");
		if (status !== previousStatus) console.log(`[release-preflight] ${sha}\n${status}`);
		previousStatus = status;
		if (checks.some((check) => check.finished && check.state !== "success")) {
			throw new Error(`Release preflight failed. Fix the candidate before creating a tag.\n${status}`);
		}
		if (checks.every((check) => check.finished && check.state === "success")) return checks;
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(`Release preflight is not ready. Wait for this commit's main checks before tagging.\n${status}`);
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(intervalMs, remaining)));
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await requireReleasePreflight({
			repository: process.env.GITHUB_REPOSITORY,
			sha: process.env.GITHUB_SHA,
			token: process.env.RELEASE_CHECK_TOKEN,
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
