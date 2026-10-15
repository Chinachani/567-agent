import { describe, expect, it } from "vitest";
import { enrichModelContexts, parseModelList } from "./model-context-metadata.js";

describe("model context metadata", () => {
	it("接口明确容量优先，只有输出长度时容量仍未知", () => {
		const listed = parseModelList([
			{ id: "gateway-model", context_window: "8192", max_output_tokens: "1024" },
			{ id: "gateway-output-only", max_tokens: 64000, max_output_tokens: 2048 },
		]);
		const models = enrichModelContexts(listed, [{ id: "gateway-model", contextWindow: 128000 }]);
		expect(models[0]).toMatchObject({ contextWindow: 8192, contextWindowSource: "api", maxTokens: 1024 });
		expect(models[1]).toMatchObject({ contextWindowSource: "unknown", maxTokens: 2048 });
		expect(models[1].contextWindow).toBeUndefined();
	});
	it("未知网关仅使用精确目录匹配，重复型号采用较小参考容量", () => {
		const listed = parseModelList(["gateway-model", "gateway-model-unverified"]);
		const models = enrichModelContexts(listed, [
			{ id: "gateway-model", contextWindow: 128000 },
			{ id: "gateway-model", contextWindow: 64000 },
		]);
		expect(models[0]).toMatchObject({ contextWindow: 64000, contextWindowSource: "catalog" });
		expect(models[1].contextWindow).toBeUndefined();
		expect(models[1].contextWindowSource).toBe("unknown");
	});
});
