/**
 * Hello Tool - Minimal custom tool example
 */

import { Type } from "@567agent/ai";
import type { ExtensionAPI } from "@567agent/coding-agent";

export default function (api: ExtensionAPI) {
	api.registerTool({
		name: "hello",
		label: "Hello",
		description: "A simple greeting tool",
		parameters: Type.Object({
			name: Type.String({ description: "Name to greet" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { name } = params as { name: string };
			return {
				content: [{ type: "text", text: `Hello, ${name}!` }],
				details: { greeted: name },
			};
		},
	});
}
