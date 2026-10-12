export function configureElectronE2eProfile(capabilities, userDataDir, environment = process.env) {
	const chromeOptions = capabilities["goog:chromeOptions"];
	if (!chromeOptions) throw new Error("Electron service did not configure ChromeDriver options");
	chromeOptions.args = [
		...(chromeOptions.args ?? []).filter((arg) => !arg.startsWith("--user-data-dir=")),
		`--user-data-dir=${userDataDir}`,
	];
	// Windows startup explicitly sets app.userData/sessionData from this override.
	// It must match ChromeDriver's directory for DevToolsActivePort discovery.
	environment.AGENT567_DESKTOP_USER_DATA_DIR = userDataDir;
}

export function resolveElectronE2eServiceOptions({ platform = process.platform, ci = process.env.CI } = {}) {
	const options = { clearMocks: true };
	if (platform !== "linux" || ci !== "true") return options;

	// Ubuntu 24.04+ blocks Electron's unprivileged user namespace unless its
	// executable has a matching AppArmor profile. GitHub-hosted runners provide
	// non-interactive sudo and are ephemeral, so let the service install its
	// narrowly scoped profile instead of disabling Chromium's sandbox globally.
	return {
		...options,
		apparmorAutoInstall: "sudo",
	};
}

export function resolveElectronE2eSpecRetryOptions({
	packaged = process.env.AGENT567_E2E_PACKAGED === "1",
} = {}) {
	const retries = packaged ? 1 : 0;
	return {
		specFileRetries: retries,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	};
}
