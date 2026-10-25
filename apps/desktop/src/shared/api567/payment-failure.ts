/** Match explicit provider availability errors, never transport failures or a generic 403. */
export function isPaymentUnavailable(message: string): boolean {
	return /(?:支付|充值|通道).{0,16}(?:未开启|未开放|未启用|已关闭|被禁用|维护中|未配置)|(?:未开启|未开放|未启用|已关闭|未配置).{0,12}(?:支付|充值|通道)|payment.{0,24}(?:disabled|not enabled|unavailable|not configured)/i.test(
		message,
	);
}
