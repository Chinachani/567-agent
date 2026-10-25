import { installRpcStdoutGuard, runAgentRuntimeCli } from "@567agent/cli-host";
import { resolveAppLanguage } from "../../shared/i18n/config.js";
import { createApi567InferenceStream } from "../567api/inference.js";
import { readConfigSync } from "../config/desktop-config-store.js";
import { initializeMainMessages } from "../i18n/messages.js";
import { createDesktopModelRuntime } from "../models/desktop-model-runtime.js";

installRpcStdoutGuard();

try {
	initializeMainMessages(
		resolveAppLanguage(readConfigSync().language ?? "system", Intl.DateTimeFormat().resolvedOptions().locale),
	);
	await runAgentRuntimeCli(process.argv.slice(2), {
		createModelRuntime: createDesktopModelRuntime,
		streamFn: createApi567InferenceStream(),
	});
} catch (error) {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
}
