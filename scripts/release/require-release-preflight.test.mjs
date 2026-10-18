import assert from "node:assert/strict";
import { test } from "node:test";
import { requireReleasePreflight } from "./require-release-preflight.mjs";

const repository = "Chinachani/567-agent";
const sha = "a".repeat(40);
const workflows = ["quality.yml", "desktop-packaged.yml"];

function run({
	sha: headSha = sha,
	event = "push",
	branch = "main",
	number = 1,
	attempt = 1,
	status = "completed",
	conclusion = "success",
} = {}) {
	return {
		head_sha: headSha,
		event,
		head_branch: branch,
		run_number: number,
		run_attempt: attempt,
		status,
		conclusion,
		html_url: `https://github.com/${repository}/actions/runs/${number}`,
	};
}

function successRuns(overrides = {}) {
	return Object.fromEntries(workflows.map((workflow) => [workflow, overrides[workflow] ?? [run()]]));
}

async function withFetch(fetcher, action) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = fetcher;
	try {
		return await action();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

function apiFetch(runsByWorkflow, { onRequest } = {}) {
	return async (input, init) => {
		const url = new URL(String(input));
		const workflow = url.pathname.split("/").at(-2);
		onRequest?.({ url, init, workflow });
		if (!(workflow in runsByWorkflow)) throw new Error(`Unexpected request: ${url}`);
		return Response.json({ workflow_runs: runsByWorkflow[workflow] });
	};
}

async function assertNotReady(runsByWorkflow, pattern = /not ready/) {
	await withFetch(apiFetch(runsByWorkflow), async () => {
		await assert.rejects(
			requireReleasePreflight({ repository, sha, token: "test-token" }),
			pattern,
		);
	});
}

test("admits exact-SHA checks from main pushes and workflow dispatches", async () => {
	const runs = successRuns({
		"quality.yml": [run({ event: "push" })],
		"desktop-packaged.yml": [run({ event: "workflow_dispatch", branch: "release/v1.3.2" })],
	});
	const requests = [];
	const result = await withFetch(apiFetch(runs, { onRequest: (request) => requests.push(request) }), () =>
		requireReleasePreflight({ repository, sha, token: "test-token" }));

	assert.deepEqual(result.map(({ workflow, state }) => ({ workflow, state })), [
		{ workflow: "quality.yml", state: "success" },
		{ workflow: "desktop-packaged.yml", state: "success" },
	]);
	assert.equal(requests.length, 2);
	for (const { url, init } of requests) {
		assert.equal(url.searchParams.get("head_sha"), sha);
		assert.equal(url.searchParams.get("per_page"), "100");
		assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-token");
	}
});

test("does not admit PR runs or runs for another SHA", async () => {
	await assertNotReady(successRuns({
		"quality.yml": [run({ event: "pull_request" })],
		"desktop-packaged.yml": [run({ sha: "b".repeat(40) })],
	}));
});

test("rejects failed and cancelled latest eligible runs", async (t) => {
	for (const conclusion of ["failure", "cancelled"]) {
		await t.test(conclusion, async () => {
			await withFetch(apiFetch(successRuns({
				"quality.yml": [run({ conclusion })],
			})), async () => {
				await assert.rejects(
					requireReleasePreflight({ repository, sha, token: "test-token" }),
					new RegExp(`quality\\.yml: ${conclusion}`),
				);
			});
		});
	}
});

test("uses the newest run number and newest retry attempt", async () => {
	const runs = successRuns({
		"quality.yml": [
			run({ number: 3, conclusion: "failure" }),
			run({ number: 4, conclusion: "success" }),
		],
		"desktop-packaged.yml": [
			run({ number: 8, attempt: 1, conclusion: "success" }),
			run({ number: 8, attempt: 2, conclusion: "failure" }),
		],
	});
	await withFetch(apiFetch(runs), async () => {
		await assert.rejects(
			requireReleasePreflight({ repository, sha, token: "test-token" }),
			/desktop-packaged\.yml: failure/,
		);
	});
});

test("waits through pending checks until both exact-SHA runs succeed", async () => {
	const queues = {
		"quality.yml": [[run({ status: "in_progress", conclusion: null })], [run()]],
		"desktop-packaged.yml": [[run({ status: "queued", conclusion: null })], [run()]],
	};
	const fetcher = async (input) => {
		const url = new URL(String(input));
		const workflow = url.pathname.split("/").at(-2);
		const responseRuns = queues[workflow].length > 1 ? queues[workflow].shift() : queues[workflow][0];
		return Response.json({ workflow_runs: responseRuns });
	};
	await withFetch(fetcher, async () => {
		const result = await requireReleasePreflight({ repository, sha, token: "test-token", maxWaitMs: 100, intervalMs: 0 });
		assert.ok(result.every(({ state }) => state === "success"));
	});
});

test("rejects GitHub errors and malformed response bodies", async (t) => {
	await t.test("HTTP error", async () => {
		await withFetch(async () => new Response("denied", { status: 403 }), async () => {
			await assert.rejects(
				requireReleasePreflight({ repository, sha, token: "test-token" }),
				/Cannot inspect quality\.yml: GitHub HTTP 403/,
			);
		});
	});
	await t.test("missing workflow_runs", async () => {
		await withFetch(async () => Response.json({}), async () => {
			await assert.rejects(
				requireReleasePreflight({ repository, sha, token: "test-token" }),
				/Invalid GitHub response for quality\.yml/,
			);
		});
	});
});

test("rejects invalid repository, incomplete SHA, and missing token before fetching", async (t) => {
	let calls = 0;
	await withFetch(async () => {
		calls += 1;
		return Response.json({ workflow_runs: [] });
	}, async () => {
		await t.test("repository", async () => {
			await assert.rejects(requireReleasePreflight({ repository: "invalid", sha, token: "t" }), /owner\/repository/);
		});
		await t.test("SHA", async () => {
			await assert.rejects(requireReleasePreflight({ repository, sha: "abc", token: "t" }), /complete commit SHA/);
		});
		await t.test("token", async () => {
			await assert.rejects(requireReleasePreflight({ repository, sha }), /GitHub token/);
		});
	});
	assert.equal(calls, 0);
});
