import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	type CommandProcessPort,
	DesktopCommandAbortedError,
	type DesktopCommandPort,
} from "../shared/desktop-command.js";
import { createNodeCommandProcessHost, NodeCommandProcessAbortedError } from "./command-process.js";

const DesktopConfigSchema = Type.Object(
	{
		agent567AppPath: Type.Optional(Type.String({ minLength: 1 })),
		vettaAppPath: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: true },
);

export interface NodeAgent567DesktopCommandPortOptions {
	readonly commandProcess?: CommandProcessPort;
	readonly platform?: NodeJS.Platform;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly agent567HomePath?: string;
	readonly fileExists?: (filePath: string) => Promise<boolean>;
	readonly readTextFile?: (filePath: string) => Promise<string>;
}

export function createNodeAgent567DesktopCommandPort(
	options: NodeAgent567DesktopCommandPortOptions = {},
): DesktopCommandPort {
	const commandProcess = options.commandProcess ?? createNodeCommandProcessHost();
	const locationOptions: Agent567ExecutableLocationOptions = {
		platform: options.platform ?? process.platform,
		environment: options.environment ?? process.env,
		agent567HomePath: options.agent567HomePath,
		fileExists: options.fileExists ?? defaultFileExists,
		readTextFile: options.readTextFile ?? defaultReadTextFile,
	};
	return {
		locate: () => findAgent567Executable(locationOptions),
		async run(executable, args, options) {
			try {
				return await commandProcess.run(executable, args, options);
			} catch (error) {
				if (error instanceof NodeCommandProcessAbortedError) throw new DesktopCommandAbortedError();
				throw error;
			}
		},
	};
}

interface Agent567ExecutableLocationOptions {
	readonly platform: NodeJS.Platform;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly agent567HomePath?: string;
	readonly fileExists: (filePath: string) => Promise<boolean>;
	readonly readTextFile: (filePath: string) => Promise<string>;
}

async function findAgent567Executable(
	options: Agent567ExecutableLocationOptions,
): Promise<{ path: string; staleConfiguredPath?: string }> {
	const environmentPath = options.environment.AGENT567_DESKTOP_EXE;
	if (environmentPath && (await options.fileExists(environmentPath))) return { path: environmentPath };
	const configuredPath = await readConfiguredAgent567AppPath(options);
	if (configuredPath && (await options.fileExists(configuredPath))) return { path: configuredPath };
	const candidates =
		options.platform === "win32"
			? [
					nodePath.join(options.environment.LOCALAPPDATA ?? "", "Programs", "567 Agent", "567-Agent.exe"),
					nodePath.join(options.environment.ProgramFiles ?? "C:\\Program Files", "567 Agent", "567-Agent.exe"),
					nodePath.join(options.environment.LOCALAPPDATA ?? "", "Programs", "Vetta", "Vetta.exe"),
					nodePath.join(options.environment.ProgramFiles ?? "C:\\Program Files", "Vetta", "Vetta.exe"),
				]
			: [
					"/usr/bin/567-agent",
					"/opt/567-agent/567-agent",
					"/Applications/567 Agent.app/Contents/MacOS/567-Agent",
					"/Applications/Vetta.app/Contents/MacOS/Vetta",
					"/usr/local/bin/567-agent",
					"/usr/local/bin/vetta-desktop",
				];
	for (const candidate of candidates) {
		if (candidate && (await options.fileExists(candidate))) {
			return { path: candidate, staleConfiguredPath: configuredPath };
		}
	}
	const staleNote = configuredPath ? ` Configured agent567AppPath is stale: ${configuredPath}` : "";
	throw new Error(
		`567 Agent executable not found. Set AGENT567_DESKTOP_EXE or start 567 Agent once to write agent567AppPath.${staleNote}`,
	);
}

async function readConfiguredAgent567AppPath(options: Agent567ExecutableLocationOptions): Promise<string | undefined> {
	try {
		const raw = await options.readTextFile(
			nodePath.join(options.agent567HomePath ?? getAgent567HomePath(), "desktop-config.json"),
		);
		const parsed: unknown = JSON.parse(raw);
		return Value.Check(DesktopConfigSchema, parsed) ? (parsed.agent567AppPath ?? parsed.vettaAppPath) : undefined;
	} catch {
		return undefined;
	}
}

/** @deprecated Use createNodeAgent567DesktopCommandPort. */
export const createNodeVettaDesktopCommandPort = createNodeAgent567DesktopCommandPort;
/** @deprecated Use NodeAgent567DesktopCommandPortOptions. */
export type NodeVettaDesktopCommandPortOptions = NodeAgent567DesktopCommandPortOptions;

async function defaultFileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		try {
			await access(filePath, constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}
}

function defaultReadTextFile(filePath: string): Promise<string> {
	return readFile(filePath, "utf8");
}
