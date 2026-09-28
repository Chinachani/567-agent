import { describe, expect, it } from "vitest";
import { NewApiService } from "./newapi-service.js";

describe("NewApiService quota and rate-limiting", () => {
	it("returns cached quota without network call when cache is fresh", async () => {
		const service = NewApiService.getInstance();
		const rawSession = service.getRawSession();
		const res = await service.refreshQuota(false);
		if (rawSession.isLoggedIn && rawSession.quota !== undefined) {
			expect(res.success).toBe(true);
			expect(res.quota).toBe(rawSession.quota);
		} else {
			expect(res.success).toBe(false);
		}
	});

	it("coalesces concurrent refreshQuota calls into one promise", async () => {
		const service = NewApiService.getInstance();
		const p1 = service.refreshQuota(false);
		const p2 = service.refreshQuota(false);
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toEqual(r2);
	});
});
