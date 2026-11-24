import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { bundleDesktopAgentRpc } from "./bundle-agent-rpc.mjs";

const responseText = { type: "output_text", text: "ok", annotations: [] };
const responseMessage = { type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [responseText] };
const responseStream = [
	{ type: "response.output_item.added", output_index: 0, item: { ...responseMessage, status: "in_progress", content: [] } },
	{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { ...responseText, text: "" } },
	{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: responseText.text },
	{ type: "response.output_item.done", output_index: 0, item: responseMessage },
	{
		type: "response.completed",
		response: {
			id: "resp_fixture",
			status: "completed",
			output: [responseMessage],
			usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
		},
	},
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";

it("runs two IM turns through the staged Node entry with fresh signatures and no Electron APIs", async () => {
	const root = mkdtempSync(join(tmpdir(), "567-node-rpc-"));
	const home = join(root, "home");
	const agent = join(home, "agent");
	mkdirSync(agent, { recursive: true });
	mkdirSync(join(home, "desktop-app"));
	writeFileSync(join(home, "desktop-app/device-fingerprint.id"), "fixture-device-fingerprint-0000000000000000");
	writeFileSync(join(home, "desktop-config.json"), JSON.stringify({ language: "en" }));
	writeFileSync(join(home, "service-route.json"), JSON.stringify({ schemaVersion: 1, route: "germany" }));
	writeFileSync(
		join(agent, "models.json"),
		JSON.stringify({
			providers: {
				"567api": {
					baseUrl: "https://api.567.wiki/v1",
					api: "openai-completions",
					apiKey: "sk-fixture",
					headers: { "X-567-Group": "default", "X-567-Nonce": "frozen" },
					models: [
						{
							id: "fixture",
							name: "Fixture",
							input: ["text"],
							contextWindow: 8192,
							maxTokens: 100,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	);
	const entry = join(root, "agent-rpc-cli.mjs");
	const logPath = join(root, "requests.jsonl");
	const preload = join(root, "transport.mjs");
	// Replace only the network boundary inside the real built subprocess. Any unexpected network fails.
	writeFileSync(
		preload,
		`import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url !== 'https://api.567.wiki/v1/responses') throw new Error('Unexpected fixture destination: ' + url);
  appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(Object.fromEntries(new Headers(init?.headers))) + '\\n');
  return new Response(${JSON.stringify(responseStream)}, {headers:{'content-type':'text/event-stream'}});
};`,
	);
	let child: ReturnType<typeof spawn> | undefined;
	try {
		bundleDesktopAgentRpc(entry);
		child = spawn(
			process.execPath,
			[
				"--import",
				// Node resolves --import as an ESM specifier; Windows drive paths must be file:// URLs.
				pathToFileURL(preload).href,
				entry,
				"--mode",
				"rpc",
				"--enable-host-bridge",
				"--scenario",
				"im-claw",
				"--provider",
				"567api",
				"--model",
				"fixture",
				"--offline",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--session-dir",
				join(root, "sessions"),
			],
			{
				cwd: root,
				env: {
					PATH: process.env.PATH,
					SystemRoot: process.env.SystemRoot,
					WINDIR: process.env.WINDIR,
					TEMP: root,
					TMP: root,
					HOME: root,
					USERPROFILE: root,
					AGENT567_HOME: home,
					AGENT567_CODING_AGENT_DIR: agent,
					AGENT567_PACKAGE_DIR: fileURLToPath(new URL("../../../packages/coding-agent", import.meta.url)),
					API567_BASE_URL: "",
					API567_TOKEN: "",
					CI: "1",
				},
				stdio: "pipe",
			},
		);
		let stderr = "";
		let pending = "";
		const frames: Record<string, unknown>[] = [];
		let changed: (() => void) | undefined;
		child.stderr!.on("data", (part) => {
			stderr += part;
		});
		child.stdout!.on("data", (part) => {
			pending += part;
			let end = pending.indexOf("\n");
			while (end !== -1) {
				const line = pending.slice(0, end);
				pending = pending.slice(end + 1);
				if (line) frames.push(JSON.parse(line));
				end = pending.indexOf("\n");
			}
			changed?.();
		});
		child.on("close", () => changed?.());
		const until = async (condition: () => boolean) => {
			while (!condition()) {
				if (child!.exitCode !== null || child!.signalCode !== null)
					throw new Error(`RPC exited: ${stderr}\n${JSON.stringify(frames)}`);
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error(`RPC timed out: ${stderr}\n${JSON.stringify(frames)}`)),
						15_000,
					);
					changed = () => {
						clearTimeout(timer);
						resolve();
					};
				});
			}
		};
		for (let turn = 1; turn <= 2; turn++) {
			child.stdin!.write(`${JSON.stringify({ id: `turn-${turn}`, type: "prompt", message: "fixture" })}\n`);
			await until(() => frames.filter((frame) => frame.type === "agent_end").length >= turn);
		}
		expect(frames.filter((frame) => frame.type === "message_end").map((frame) => frame.message)).toEqual([
			expect.objectContaining({ role: "assistant", stopReason: "stop" }),
			expect.objectContaining({ role: "assistant", stopReason: "stop" }),
		]);
		const requests = readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(requests).toHaveLength(2);
		for (const headers of requests) {
			expect(headers["authorization"]).toBe("Bearer sk-fixture");
			expect(headers["x-567-group"]).toBe("default");
			expect(headers["x-567-signature"]).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(requests[0]["x-567-nonce"]).not.toBe("frozen");
		expect(requests[0]["x-567-nonce"]).not.toBe(requests[1]["x-567-nonce"]);
	} finally {
		if (child && child.exitCode === null) {
			child.kill();
			await once(child, "close");
		}
		rmSync(root, { recursive: true, force: true });
	}
}, 60_000);
