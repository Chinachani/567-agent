import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { createVettaActionRegistrar } from "../action-usage";

type MarketplaceQuery = {
	query: string;
	type?: "skill" | "scene" | "mcp" | "plugin" | "bundle";
	limit?: number;
};

const inputSchema: PluginJsonSchema = {
	type: "object",
	properties: {
		query: { type: "string", maxLength: 200 },
		type: { enum: ["skill", "scene", "mcp", "plugin", "bundle"] },
		limit: { type: "integer", minimum: 1, maximum: 20 },
	},
	required: ["query"],
	additionalProperties: false,
};

const examples: PluginAppActionExample<MarketplaceQuery>[] = [
	{ description: "在应用内能力市场查找 MCP", input: { query: "GitHub repository search", type: "mcp" } },
	{ description: "按关键词查找可安装技能", input: { query: "spreadsheet", type: "skill", limit: 5 } },
];

export function registerMarketplaceActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "marketplace");
	register<MarketplaceQuery>({
		id: "marketplace.search",
		publicId: "marketplace.search",
		title: "搜索能力市场",
		summary: "搜索 567 Agent 应用内已加载的能力市场目录，查找 MCP、技能、场景和插件。",
		description:
			"只搜索应用内能力市场当前已加载的目录，不扫描本地安装目录，也不会自行访问任意网络来源。可传 type 限定类型。metadataIncomplete 为 true 或文档/项目仓库字段缺失时，不要推测补全；MCP 标记 unreviewed 或 installable:false 时应明确说明审核/安装状态，不能据此宣称安全。若目录未加载，请引导用户打开「能力 → 发现更多能力」并刷新市场。",
		keywords: ["能力市场", "技能市场", "MCP 市场", "找 MCP", "找技能", "推荐能力", "搜索能力", "marketplace"],
		effect: "read",
		inputSchema,
		examples,
		handler: async ({ input }) => ctx.official.marketplace.search(input),
	});
}
