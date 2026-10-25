import type { PluginContext } from "@vetta-org/plugin-sdk";

/** The host exports its resolved data root, including Windows' selected data disk. */
export async function resolveDesignDataRoot(ctx: PluginContext): Promise<string> {
	const result = await ctx.command.run("node", ["-p", "process.env.AGENT567_HOME || require('path').join(require('os').homedir(), '.567agent')"]);
	const root = result.stdout.trim();
	if (result.exitCode !== 0 || !root) throw new Error(`resolve data root failed: ${result.stderr || result.stdout}`);
	return root.replace(/[/\\]+$/, "");
}
