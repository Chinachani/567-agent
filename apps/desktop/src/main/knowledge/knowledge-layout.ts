import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";

export function getKnowledgeRoot(): string {
	return join(getAgent567HomePath(), "knowledges");
}
