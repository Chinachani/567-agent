import { isAbsolute } from "node:path";
import { app } from "electron";
import { REMOTE_CAPTURE_HELPER_SWITCH, REMOTE_CAPTURE_PROFILE_ENV } from "./remote-control/remote-capture-channel.js";

const isCaptureHelper = process.argv.includes(REMOTE_CAPTURE_HELPER_SWITCH);

// Route before evaluating the GUI module graph, single-instance lock or user stores.
async function start(): Promise<void> {
	if (!isCaptureHelper) {
		await import("./main.js");
		return;
	}
	const profile = process.env[REMOTE_CAPTURE_PROFILE_ENV];
	if (process.platform !== "linux" || !process.send || !profile || !isAbsolute(profile)) {
		app.exit(64);
		return;
	}
	app.setPath("userData", profile);
	app.setPath("sessionData", profile);
	app.commandLine.appendSwitch("ozone-platform", "x11");
	const { runRemoteCaptureHelper } = await import("./remote-control/remote-capture-helper.js");
	runRemoteCaptureHelper();
}

// Electron must await routing before emitting ready; main.ts registers privileged
// schemes and command-line switches that are invalid after ready.
await start().catch((error: unknown) => {
	if (isCaptureHelper) app.exit(1);
	else throw error;
});
