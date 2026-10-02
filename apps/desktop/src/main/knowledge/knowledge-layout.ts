import { join } from "node:path";
import { getVettaHomePath } from "@567agent/action-rpc";

export function getKnowledgeRoot(): string {
	return join(getVettaHomePath(), "knowledges");
}
