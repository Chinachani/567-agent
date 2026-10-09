import { join } from "node:path";
import {
	type CodingAgentBootstrap,
	type CodingAgentBootstrapDiagnostics,
	createCodingAgentBootstrap,
} from "@567agent/coding-agent/bootstrap";
import { ENV_API567_BASE_URL, getAgentDir } from "@567agent/coding-agent/config";
import { createCodingAgentAuthRuntime, createCodingAgentModelRuntime } from "@567agent/coding-agent/host-services";
import {
	NodeTransactionalTextStorage,
	nodeConfigurationValueResolver,
	nodeSyncTextFileSource,
} from "@567agent/runtime-node/host";
import chalk from "chalk";
import { createCliSessionResourceRuntime, createCliSettingsRuntime } from "./coding-agent-resource-runtime.js";
import { runMigrations as runCodingAgentStartupMigrations } from "./startup-migrations.js";

export interface CreateCliCodingAgentBootstrapOptions extends CodingAgentBootstrapDiagnostics {
	readonly args: string[];
	readonly cwd?: string;
	readonly agentDir?: string;
}

/** Select the concrete Node state and resource implementations used by the CLI host. */
export async function createCliCodingAgentBootstrap(
	options: CreateCliCodingAgentBootstrapOptions,
): Promise<CodingAgentBootstrap> {
	applyOfflineMode(options.args);
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	runCodingAgentStartupMigrations({ cwd, agentDir });

	const settingsManager = createCliSettingsRuntime(cwd, agentDir);
	const authStorage = createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(join(agentDir, "auth.json")), {
		configurationValueResolver: nodeConfigurationValueResolver,
	});
	const modelRegistry = createCodingAgentModelRuntime(authStorage, {
		modelsJsonPath: join(agentDir, "models.json"),
		configFileSource: nodeSyncTextFileSource,
		configurationValueResolver: nodeConfigurationValueResolver,
	});

	return createCodingAgentBootstrap({
		args: options.args,
		cwd,
		agentDir,
		settingsManager,
		authStorage,
		modelRegistry,
		serverUrlOverride: process.env[ENV_API567_BASE_URL],
		createResourceRuntime: ({ parsed, settings }) =>
			createCliSessionResourceRuntime({
				cwd,
				agentDir,
				settings,
				additionalExtensionPaths: parsed.extensions,
				additionalSkillPaths: parsed.skills,
				additionalPromptTemplatePaths: parsed.promptTemplates,
				additionalThemePaths: parsed.themes,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
			}),
		onSettingsError: options.onSettingsError ?? reportSettingsError,
		onExtensionError: options.onExtensionError ?? reportExtensionError,
		onArgumentWarning: options.onArgumentWarning ?? reportArgumentWarning,
	});
}

function applyOfflineMode(args: readonly string[]): void {
	if (!args.includes("--offline")) return;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
}

function reportSettingsError({
	scope,
	error,
}: Parameters<NonNullable<CodingAgentBootstrapDiagnostics["onSettingsError"]>>[0]): void {
	console.error(chalk.yellow(`Warning (startup, ${scope} settings): ${error.message}`));
	if (error.stack) console.error(chalk.dim(error.stack));
}

function reportExtensionError({
	path,
	error,
}: Parameters<NonNullable<CodingAgentBootstrapDiagnostics["onExtensionError"]>>[0]): void {
	console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
}

function reportArgumentWarning(warning: string): void {
	console.error(chalk.yellow(`Warning: ${warning}`));
}
