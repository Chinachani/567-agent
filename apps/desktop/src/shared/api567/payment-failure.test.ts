import { expect, it } from "vitest";
import { isPaymentUnavailable } from "./payment-failure";

it("recognizes explicit disabled channels without relabeling network, auth or amount failures", () => {
	for (const message of ["支付通道未开启", "在线支付暂未开放", "管理员未配置支付信息", "payment is disabled"])
		expect(isPaymentUnavailable(message), message).toBe(true);
	for (const message of ["Failed to fetch", "HTTP 403", "金额不足", "请先登录"])
		expect(isPaymentUnavailable(message), message).toBe(false);
});
