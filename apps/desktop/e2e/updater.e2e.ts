import type { DesktopUpdaterApi } from "../src/preload/api-types/updater.js";

type UpdaterCheckOutcome = {
	state: Awaited<ReturnType<DesktopUpdaterApi["check"]>> | null;
	error: { name: string; message: string; stack?: string } | null;
};

const packaged = process.env.AGENT567_E2E_PACKAGED === "1";
const UPDATE_TIMEOUT_MS = 60_000;

describe("567 Agent packaged updater", () => {
	(packaged ? it : it.skip)("checks the configured update feed through the packaged updater API", async () => {
		await browser.waitUntil(
			async () => {
				const ready = await browser.execute(() => document.readyState);
				return ready === "complete" || ready === "interactive";
			},
			{ timeout: UPDATE_TIMEOUT_MS, timeoutMsg: "Renderer was not ready before updater E2E" },
		);
		await browser.waitUntil(
			async () => browser.execute(() => Boolean(window.vettaE2e?.updater)),
			{ timeout: UPDATE_TIMEOUT_MS, timeoutMsg: "Packaged updater E2E bridge was not ready" },
		);

		const currentVersion = await browser.electron.execute((electron) => electron.app.getVersion());
		expect(currentVersion).toMatch(/^\d+\.\d+\.\d+$/);

		// The packaged release is intentionally logged out in CI. Use the renderer's
		// host-access-wrapped updater API instead of navigating through Settings or
		// calling the protected raw preload API from WebDriver's page world.
		await browser.setTimeout({ script: UPDATE_TIMEOUT_MS });
		const outcome = await browser.executeAsync<UpdaterCheckOutcome, []>((done) => {
			Promise.resolve()
				.then(() => window.vettaE2e!.updater.check())
				.then(
					(state) => done({ state, error: null }),
					(error: unknown) => done({
						state: null,
						error: error instanceof Error
							? { name: error.name, message: error.message, stack: error.stack }
							: { name: "UnknownError", message: String(error), stack: undefined },
					}),
				);
		});
		console.log("[updater-e2e] check result", JSON.stringify(outcome));
		if (outcome.error || outcome.state?.phase === "error") {
			try {
				const diagnostics = await browser.electron.execute(() => {
					const fs = process.getBuiltinModule("fs");
					const path = process.getBuiltinModule("path");
					const home = process.env.AGENT567_HOME;
					if (!home) return { error: "E2E home is unset" };
					const directory = path.join(home, "desktop-app", "logs", "main");
					return fs.readdirSync(directory)
						.filter((name) => name.endsWith(".log"))
						.sort().slice(-2)
						.map((name) => ({ name, tail: fs.readFileSync(path.join(directory, name), "utf8").slice(-12_000) }));
				});
				console.error("[updater-e2e] main diagnostics", JSON.stringify(diagnostics));
			} catch (error) {
				console.error("[updater-e2e] could not read main diagnostics", error);
			}
		}
		expect(outcome.error).toBeNull();
		const state = outcome.state;
		expect(state).not.toBeNull();
		if (!state) throw new Error("Updater check returned no state");
		expect(state.currentVersion).toBe(currentVersion);

		if (process.platform === "linux") {
			expect(state.phase).toBe("available");
			expect(state.latestVersion).toBeDefined();
			await browser.execute(() => window.vettaE2e!.updater.download());
			await browser.waitUntil(
				async () => (await browser.execute(() => window.vettaE2e!.updater.getState())).phase === "ready",
				{ timeout: UPDATE_TIMEOUT_MS, timeoutMsg: "Updater API did not finish downloading the fixture" },
			);
		} else {
			expect(state.phase).toBe("idle");
			expect(state.latestVersion).toBe(currentVersion);
		}
	});
});
