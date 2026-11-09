/** Magpie is a local proxy preset, not an arbitrary credential-forwarding endpoint. */
export function isMagpieBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "http:" &&
			url.hostname === "127.0.0.1" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			url.pathname === "/v1" &&
			(url.port === "" || (Number(url.port) >= 1 && Number(url.port) <= 65535))
		);
	} catch {
		return false;
	}
}
