import { spawn } from "node:child_process";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("serves the development relay locally and refuses connections through a network interface", async () => {
	const child = spawn("bun", [fileURLToPath(new URL("../scripts/fake-relay-server.ts", import.meta.url))], {
		env: { ...process.env, AGENT567_FAKE_RELAY_PORT: "0" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	try {
		const output = (await once(child.stdout, "data"))[0].toString();
		const port = /127\.0\.0\.1:(\d+)/.exec(output)?.[1];
		expect(port).toBeTruthy();
		expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true, rooms: 0 });
		for (const address of Object.values(networkInterfaces()).flat()) {
			if (!address || address.family !== "IPv4" || address.internal) continue;
			await expect(
				fetch(`http://${address.address}:${port}/health`, { signal: AbortSignal.timeout(1000) }),
			).rejects.toThrow();
		}
	} finally {
		const closed = once(child, "exit");
		child.kill();
		await closed;
	}
});
