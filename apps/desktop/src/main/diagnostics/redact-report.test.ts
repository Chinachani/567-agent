import { describe, expect, it } from "vitest";
import { logRingBuffer } from "../logger/log-ring-buffer.js";
import { redactDiagnosticLog, redactDiagnosticValue } from "./redact-report.js";

describe("shareable diagnostic logs", () => {
	it("serializes real ring entries safely while preserving the local diagnostic source", () => {
		logRingBuffer.clear();
		logRingBuffer.push({
			ts: "test",
			level: "error",
			scope: "test",
			msg: 'config: {"password":"ring-secret-should-disappear"}',
			fields: { cookie: "session=should-disappear", safeCount: 3 },
		});
		const entry = logRingBuffer.snapshot()[0];
		const output = JSON.stringify(redactDiagnosticValue(entry));
		expect(output).not.toContain("should-disappear");
		expect(JSON.parse(output)).toMatchObject({ fields: { safeCount: 3 } });
		expect(entry?.msg).toContain("ring-secret-should-disappear");
		logRingBuffer.clear();
	});

	it("omits malformed embedded credential data instead of exporting undecodable secrets", () => {
		expect(redactDiagnosticLog('prefix {\\"password\\":\\"example-secret-should-disappear\\"')).not.toContain(
			"should-disappear",
		);
	});

	it("redacts structured entries and JSON encoded inside messages without losing safe fields", () => {
		const input = JSON.stringify({
			level: "error",
			message:
				'request configuration: {"apiKey":"example-key-should-disappear","nested":{"password":"example-pass-should-disappear"}}',
			detail: { authorization: "Basic example-basic-should-disappear", count: 7 },
		});
		const output = redactDiagnosticLog(input);
		expect(output).not.toContain("should-disappear");
		expect(JSON.parse(output)).toMatchObject({ level: "error", detail: { count: 7 } });
	});

	it("removes full HTTP authentication and cookie values, keeping the next header", () => {
		const output = redactDiagnosticLog(
			"Authorization: Basic example-basic-should-disappear\nCookie: sid=example-cookie-should-disappear; csrf=example-csrf-should-disappear\nContent-Type: application/json",
		);
		expect(output).not.toContain("should-disappear");
		expect(output).toContain("Content-Type: application/json");
	});

	it("handles multiple JSON encoding layers and malformed surrounding text", () => {
		const secret = "example-escaped-should-disappear";
		let nested = JSON.stringify({ refresh_token: secret });
		for (let depth = 0; depth < 3; depth++) nested = JSON.stringify({ message: nested });
		expect(redactDiagnosticLog(nested)).not.toContain(secret);
		expect(redactDiagnosticLog(`failed: {"password":"${secret}"} trailing text`)).not.toContain(secret);
	});
});
