import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import type { AgentPresetPackage } from "../../agent-teams/plugin-agent-presets.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import { assertSafeSkillTree } from "./skill-package.js";

/** Validate the complete prompt package before it can replace a cached snapshot. */
export function readExpertPresetPackage(
	root: string,
	ability: Extract<MarketplaceAbilityManifest, { type: "plugin" }>,
	source: { sourceId: string; repository: string },
): AgentPresetPackage {
	assertSafeSkillTree(root);
	const read = (path: string, limit: number): Buffer => {
		const target = realpathSync(resolve(root, path));
		const rel = relative(realpathSync(root), target);
		if (!rel || isAbsolute(path) || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
			throw new Error("Expert resource escapes package");
		const stat = statSync(target);
		if (!stat.isFile() || stat.size > limit) throw new Error(`Invalid expert resource: ${path}`);
		return readFileSync(target);
	};
	const manifest = parsePluginManifest(JSON.parse(read("plugin.json", 256 * 1024).toString("utf8")));
	if (manifest.id !== ability.slug || manifest.version !== ability.version)
		throw new Error("Expert package identity mismatch");
	if (!manifest.agent?.agents?.length || manifest.agent.teams?.length)
		throw new Error("Expert packages must declare agents only");
	// A prompt catalog cannot acquire tool, command or global prompt contributions.
	if (
		manifest.permissions?.length ||
		manifest.commands?.length ||
		manifest.agent.skillPaths?.length ||
		manifest.agent.mcpServers ||
		manifest.agent.systemPrompt ||
		manifest.agent.toolPolicy
	)
		throw new Error("Expert package contains executable contributions");
	const locales: Record<string, Record<string, string>> = {};
	const localeFiles = existsSync(join(root, "locales")) ? readdirSync(join(root, "locales")) : [];
	if (localeFiles.length > 32) throw new Error("Too many expert locales");
	for (const file of localeFiles) {
		if (!/^[a-z]{2}(?:-[A-Za-z0-9]+)?\.json$/.test(file)) continue;
		const raw: unknown = JSON.parse(read(`locales/${file}`, 256 * 1024).toString("utf8"));
		if (
			!raw ||
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			Object.values(raw).some((v) => typeof v !== "string")
		)
			throw new Error("Invalid expert translations");
		locales[file.slice(0, -5)] = raw as Record<string, string>;
	}
	const defaultLocale = manifest.defaultLocale ?? "zh";
	const requireText = (text: string, limit: number) => {
		const key = /^%([^%]+)%$/.exec(text)?.[1];
		const fallback = key ? locales[defaultLocale]?.[key] : text;
		if (!fallback?.trim() || fallback.length > limit) throw new Error("Missing or oversized expert text");
		for (const values of Object.values(locales)) {
			const translated = key ? values[key] : text;
			if (translated !== undefined && (!translated.trim() || translated.length > limit))
				throw new Error("Invalid expert translation length");
		}
	};
	requireText(manifest.name, 128);
	if (manifest.agent.agents.length > 128) throw new Error("Too many expert declarations");
	const ids = new Set<string>();
	for (const agent of manifest.agent.agents) {
		if (ids.has(agent.id) || agent.legacyIds?.length || agent.roles?.length)
			throw new Error("Invalid expert identity or provider takeover");
		ids.add(agent.id);
		requireText(agent.name, 128);
		if (agent.description) requireText(agent.description, 64000);
		const prompt = agent.systemPromptPath
			? read(agent.systemPromptPath, 256 * 1024).toString("utf8")
			: agent.systemPrompt;
		if (!prompt?.trim() || prompt.length > 64000 || Buffer.byteLength(prompt) > 256 * 1024)
			throw new Error("Missing or oversized expert prompt");
		if (agent.avatar) {
			if (![".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(agent.avatar).toLowerCase()))
				throw new Error("Unsupported expert avatar");
			read(agent.avatar, 512 * 1024);
		}
	}
	return {
		id: manifest.id,
		name: manifest.name,
		agent: { agents: manifest.agent.agents },
		defaultLocale,
		locales,
		enabled: true,
		rootPath: root,
		presetSource: source,
	};
}
