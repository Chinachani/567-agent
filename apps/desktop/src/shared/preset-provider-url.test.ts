import { expect, it } from "vitest";
import { isMagpieBaseUrl } from "./preset-provider-url.js";

it("only accepts local Magpie ports without credentials, other paths or remote hosts", () => {
	for (const url of ["http://127.0.0.1:3425/v1", "http://127.0.0.1:65535/v1", "http://127.0.0.1:80/v1"])
		expect(isMagpieBaseUrl(url)).toBe(true);
	for (const url of [
		"https://127.0.0.1:3425/v1",
		"http://remote.test:3425/v1",
		"http://127.0.0.1:0/v1",
		"http://127.0.0.1:65536/v1",
		"http://user@127.0.0.1/v1",
		"http://127.0.0.1/v1?q=1",
		"http://127.0.0.1/other",
	])
		expect(isMagpieBaseUrl(url)).toBe(false);
});
