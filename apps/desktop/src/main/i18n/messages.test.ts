import { expect, it } from "vitest";
import { changeMainLanguage, initializeMainMessages, mainT } from "./messages.js";

it("initializes and switches desktop and Node RPC messages synchronously", () => {
	initializeMainMessages("zh");
	expect(mainT("api567Credentials.destinationChanged")).toContain("服务地址发生变化");
	changeMainLanguage("en");
	expect(mainT("api567Credentials.destinationChanged")).toContain("destination changed");
});
