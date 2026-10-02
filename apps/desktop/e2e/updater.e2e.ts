const packaged = process.env.VETTA_E2E_PACKAGED === "1";
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
		const state = await browser.execute(() => window.vettaE2e!.updater.check());
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
		}
	});
});
