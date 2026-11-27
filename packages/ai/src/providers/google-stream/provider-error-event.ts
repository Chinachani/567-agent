/** Google may send a structured API error inside an otherwise successful HTTP stream. */
export function throwGoogleProviderErrorEvent(chunk: unknown): void {
	if (typeof chunk !== "object" || chunk === null || !("error" in chunk)) return;
	const { error } = chunk;
	if (
		typeof error !== "object" ||
		error === null ||
		!("code" in error) ||
		typeof error.code !== "number" ||
		!Number.isInteger(error.code) ||
		error.code < 400 ||
		error.code > 599 ||
		!("message" in error) ||
		typeof error.message !== "string" ||
		!error.message.trim()
	)
		return;
	throw Object.assign(new Error(error.message), { status: error.code, responseBody: chunk, phase: "stream" });
}
