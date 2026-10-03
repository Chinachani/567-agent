import { describe, expect, it } from "vitest";
import { decryptSecret } from "./security.js";

describe("decryptSecret", () => {
	it("does not return malformed or unknown encrypted values as plaintext", () => {
		expect(decryptSecret("enc:v3:unsupported")).toBeUndefined();
		expect(decryptSecret("enc:v1:malformed")).toBeUndefined();
	});
});
