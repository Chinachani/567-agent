import { createServer } from "node:http";
import { createHash } from "node:crypto";

function incrementPatch(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Invalid E2E fixture version: ${version}`);
	return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function yamlForVersion(version, artifact) {
	// Keep one checksum-bearing file so electron-updater can resolve the
	// platform file list. The equal-version mode still prevents a download.
	const checksum = Buffer.alloc(64).toString("base64");
	return [
		`version: ${version}`,
		"files:",
		`  - url: ${artifact?.name ?? `Vetta-${version}-e2e.test`}`,
		`    size: ${artifact?.body.length ?? 0}`,
		`    sha512: ${artifact?.sha512 ?? checksum}`,
		"releaseDate: 2026-01-01T00:00:00.000Z",
		"",
	].join("\n");
}

/**
 * Start a local, deterministic generic update feed for packaged E2E tests.
 * `downloadable` exercises electron-updater's real download and checksum path
 * without attempting a platform installer handoff.
 */
export async function startUpdateFeedFixture(versionOrOptions) {
	const options = typeof versionOrOptions === "string" ? { version: versionOrOptions } : versionOrOptions;
	const version = options.version;
	const metadataDelayMs = options.metadataDelayMs ?? 0;
	if (!Number.isInteger(metadataDelayMs) || metadataDelayMs < 0) {
		throw new Error(`Invalid E2E fixture metadata delay: ${String(metadataDelayMs)}`);
	}
	const artifact = options.downloadable
		? (() => {
			const body = Buffer.alloc(5 * 1024 * 1024);
			body.write("vetta-packaged-e2e-update\n", "utf8");
			return {
				name: "Vetta-e2e-update.AppImage",
				body,
				sha512: createHash("sha512").update(body).digest("base64"),
			};
		})()
		: undefined;
	const feedVersion = artifact ? incrementPatch(version) : version;
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (artifact && pathname === `/${artifact.name}`) {
			response.writeHead(302, { Location: `/asset/${artifact.name}` }).end();
			return;
		}
		if (artifact && pathname === `/asset/${artifact.name}`) {
			const requestedRange = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
			const start = requestedRange ? Number(requestedRange[1]) : 0;
			const end = requestedRange?.[2] ? Number(requestedRange[2]) : artifact.body.length - 1;
			if (start > end || end >= artifact.body.length) { response.writeHead(416).end(); return; }
			response.writeHead(requestedRange ? 206 : 200, {
				"Content-Type": "application/octet-stream",
				"Content-Length": end - start + 1,
				"Accept-Ranges": "bytes",
				...(requestedRange ? { "Content-Range": `bytes ${start}-${end}/${artifact.body.length}` } : {}),
				"Cache-Control": "no-store",
			});
			response.end(request.method === "HEAD" ? undefined : artifact.body.subarray(start, end + 1));
			return;
		}
		if (!/^\/latest(?:-mac|-linux)?\.yml$/.test(pathname)) {
			response.writeHead(404).end();
			return;
		}
		if (metadataDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, metadataDelayMs));
		}
		const body = yamlForVersion(feedVersion, artifact);
		response.writeHead(200, {
			"Content-Type": "application/yaml",
			"Content-Length": Buffer.byteLength(body),
			"Cache-Control": "no-store",
		});
		response.end(body);
	});
	server.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => {
		server.once("listening", resolve);
		server.once("error", reject);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Unable to start the packaged E2E update feed fixture");
	}
	return {
		server,
		url: `http://127.0.0.1:${address.port}/`,
	};
}
