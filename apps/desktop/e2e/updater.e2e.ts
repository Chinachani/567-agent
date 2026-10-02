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

		const currentVersion = await browser.electron.execute((electron) => electron.app.getVersion());
		expect(currentVersion).toMatch(/^\d+\.\d+\.\d+$/);

		// The packaged release is intentionally logged out in CI, so Api567AuthGate
		// renders the login screen instead of Settings. Exercise the same preload API
		// used by the settings button without requiring a real account.
		const state = await browser.execute(() => window.vetta.updater.check());
		expect(state.currentVersion).toBe(currentVersion);

		if (process.platform === "linux") {
			expect(state.phase).toBe("available");
			expect(state.latestVersion).toBeDefined();
			await browser.execute(() => window.vetta.updater.download());
			await browser.waitUntil(
				async () => (await browser.execute(() => window.vetta.updater.getState())).phase === "ready",
				{ timeout: UPDATE_TIMEOUT_MS, timeoutMsg: "Updater API did not finish downloading the fixture" },
			);
		} else {
			expect(state.phase).toBe("idle");
		}
	});
});
