#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FILE_PREVIEW_LIMIT = 12;
const GITHUB_COMPARE_FILE_LIMIT = 300;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const manifestPath = new URL("../docs/upstreams/sources.json", import.meta.url);

export function buildCommitApiUrl(repository, ref) {
	return `https://api.github.com/repos/${repository}/commits/${ref}`;
}

export function buildCompareApiUrl(repository, pinned, head) {
	return `https://api.github.com/repos/${repository}/compare/${pinned}...${head}`;
}

export function buildBrowserCompareUrl(repository, pinned, head) {
	return `https://github.com/${repository}/compare/${pinned}...${head}`;
}

export function classifyChangedFiles(files, highValuePaths) {
	const changedPathSet = new Set();
	const highValueFiles = [];
	for (const file of Array.isArray(files) ? files : []) {
		if (!file?.filename) continue;
		changedPathSet.add(file.filename);
		if (file.previous_filename) changedPathSet.add(file.previous_filename);
		if (
			highValuePaths.some((prefix) => file.filename.startsWith(prefix) || file.previous_filename?.startsWith(prefix))
		) {
			highValueFiles.push(file.filename);
		}
	}
	return {
		changedFiles: [...changedPathSet],
		highValueFiles,
		changedEntryCount: Array.isArray(files) ? files.length : 0,
	};
}

export function resolveResult({ comparison, headSha, source, classified }) {
	const isIdentical = comparison.status === "identical";
	const latestCommit = isIdentical ? source.pinned : headSha;
	const missingFiles = !Array.isArray(comparison.files);
	const truncated = missingFiles || comparison.files.length >= GITHUB_COMPARE_FILE_LIMIT;
	const nonForward = !isIdentical && comparison.status !== "ahead";
	const status = isIdentical
		? "up-to-date"
		: truncated || nonForward
			? "partial-update"
			: classified.highValueFiles.length > 0
				? "high-value-update"
				: "update";
	const compareTarget = latestCommit ?? source.ref;
	const compareStatus = typeof comparison.status === "string" ? comparison.status : null;
	return {
		id: source.id,
		repository: source.repository,
		pinned: source.pinned,
		ref: source.ref,
		latest: latestCommit,
		status,
		changedEntryCount: classified.changedEntryCount,
		changedCount: classified.changedEntryCount,
		highValueCount: classified.highValueFiles.length,
		changedFiles: classified.changedFiles,
		highValueFiles: classified.highValueFiles,
		truncated,
		nonForward,
		compareStatus,
		compareApiUrl: buildCompareApiUrl(source.repository, source.pinned, compareTarget),
		compareUrl: buildBrowserCompareUrl(source.repository, source.pinned, compareTarget),
	};
}

function unavailableResult(source, error) {
	return {
		id: source.id,
		repository: source.repository,
		pinned: source.pinned,
		ref: source.ref,
		latest: null,
		status: "unavailable",
		error: error instanceof Error ? error.message : String(error),
		truncated: false,
		compareApiUrl: buildCommitApiUrl(source.repository, source.ref),
		compareUrl: `https://github.com/${source.repository}/commits/${source.ref}`,
	};
}

function partialResultForKnownHead({ source, headSha, error }) {
	return {
		id: source.id,
		repository: source.repository,
		pinned: source.pinned,
		ref: source.ref,
		latest: headSha,
		status: "partial-update",
		changedEntryCount: null,
		changedCount: null,
		highValueCount: null,
		changedFiles: null,
		highValueFiles: null,
		truncated: true,
		nonForward: false,
		error: error instanceof Error ? error.message : String(error),
		compareApiUrl: buildCompareApiUrl(source.repository, source.pinned, headSha),
		compareUrl: buildBrowserCompareUrl(source.repository, source.pinned, headSha),
	};
}

async function readManifest() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const ids = manifest.sources.map((source) => source.id);
	if (new Set(ids).size !== ids.length) throw new Error("Upstream source IDs must be unique");
	return manifest;
}

async function fetchJson(url, fetchImpl, timeoutMs, label) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "567-agent-upstream-check",
			},
			redirect: "error",
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`GitHub ${label} returned HTTP ${response.status}`);
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

export async function checkUpstreams({ fetchImpl = globalThis.fetch, manifest, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
	const resolvedManifest = manifest ?? (await readManifest());
	const results = [];
	for (const source of resolvedManifest.sources) {
		try {
			const refCommit = await fetchJson(
				buildCommitApiUrl(source.repository, source.ref),
				fetchImpl,
				timeoutMs,
				"commits request",
			);
			const headSha = typeof refCommit?.sha === "string" ? refCommit.sha : null;
			if (!headSha || !FULL_SHA_PATTERN.test(headSha))
				throw new Error("GitHub commits request did not return a full 40-character SHA");
			if (!FULL_SHA_PATTERN.test(source.pinned)) throw new Error("Manifest pin must be a full 40-character SHA");
			if (headSha === source.pinned) {
				results.push(
					resolveResult({
						comparison: { status: "identical", files: [] },
						headSha,
						source,
						classified: { changedFiles: [], highValueFiles: [], changedEntryCount: 0 },
					}),
				);
				continue;
			}
			try {
				const comparison = await fetchJson(
					buildCompareApiUrl(source.repository, source.pinned, headSha),
					fetchImpl,
					timeoutMs,
					"compare",
				);
				const classified = classifyChangedFiles(comparison.files, source.highValuePaths);
				results.push(resolveResult({ comparison, headSha, source, classified }));
			} catch (error) {
				results.push(partialResultForKnownHead({ source, headSha, error }));
			}
		} catch (error) {
			results.push(unavailableResult(source, error));
		}
	}
	return results;
}

function printResults(results, filePreviewLimit) {
	for (const result of results) {
		const detail =
			result.status === "unavailable"
				? ` · ${result.error}`
				: ` · latest ${result.latest}${result.changedCount == null ? ` · compare failed: ${result.error}` : ` · ${result.changedCount} changed paths`}`;
		console.log(`[upstream:${result.id}] ${result.status}${detail}`);
		console.log(`  compare ${result.compareUrl}`);
		if (result.nonForward)
			console.log(
				`  notice compare returned ${result.compareStatus ?? "a non-forward state"}; it is not a complete forward diff; review ${result.compareApiUrl}`,
			);
		else if (result.truncated && result.changedEntryCount === 300)
			console.log(`  notice compare response was truncated at 300 entries; review ${result.compareApiUrl}`);
		else if (result.truncated)
			console.log(`  notice compare response did not include a usable file list; review ${result.compareApiUrl}`);
		for (const file of (result.highValueFiles ?? []).slice(0, filePreviewLimit)) console.log(`  high-value ${file}`);
		if ((result.highValueCount ?? 0) > filePreviewLimit)
			console.log(`  high-value ... ${result.highValueCount - filePreviewLimit} more`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const strict = process.argv.includes("--strict");
	const filePreviewLimit = Number(process.env.UPSTREAM_FILE_PREVIEW_LIMIT ?? DEFAULT_FILE_PREVIEW_LIMIT);
	const results = await checkUpstreams();
	printResults(results, Number.isFinite(filePreviewLimit) ? filePreviewLimit : DEFAULT_FILE_PREVIEW_LIMIT);
	if (strict && results.some((result) => result.status !== "up-to-date")) process.exitCode = 1;
}
