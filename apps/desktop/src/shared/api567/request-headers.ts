/** Security proofs belong to one HTTP attempt and must never be saved in a model catalog. */
export function stripApi567DynamicHeaders(
	headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	return Object.fromEntries(
		Object.entries(headers).filter(
			([name]) => !/^x-567-(?:client|version|device-id|timestamp|nonce|signature)$/i.test(name),
		),
	);
}
