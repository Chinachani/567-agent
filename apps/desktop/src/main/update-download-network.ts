import { createHash } from "node:crypto";
import { net, session } from "electron";
import type { UpdateFetch } from "./update-download.js";

/** Electron fetch rejects manual redirects. Probe one byte with net.request, then stream without redirects. */
export function createDownloadFetch(): UpdateFetch {
	const discoveries = new Map<string, { expires: number; redirect: { status: number; location: string } | null }>();
	return async (url, init) => {
		const identity = new Headers(init.headers);
		identity.delete("Range");
		identity.delete("If-Range");
		const key = createHash("sha256")
			.update(url)
			.update(JSON.stringify([...identity]))
			.digest("hex");
		const remembered = discoveries.get(key);
		if (remembered && remembered.expires <= Date.now()) discoveries.delete(key);
		const updateSession = session.fromPartition("electron-updater", { cache: false });
		const redirect =
			remembered && remembered.expires > Date.now()
				? remembered.redirect
				: await new Promise<{ status: number; location: string } | null>((resolve, reject) => {
						const request = net.request({
							url,
							method: "GET",
							redirect: "manual",
							session: updateSession,
							credentials: "omit",
							useSessionCookies: false,
						});
						let settled = false;
						const cleanup = () => init.signal?.removeEventListener("abort", abort);
						const abort = () => {
							if (settled) return;
							settled = true;
							cleanup();
							request.abort();
							reject(init.signal?.reason ?? new Error("Update request cancelled"));
						};
						for (const [name, value] of new Headers(init.headers)) request.setHeader(name, value);
						request.setHeader("Range", "bytes=0-0");
						request.on("redirect", (status, _method, location) => {
							if (settled) return;
							settled = true;
							cleanup();
							request.abort();
							resolve({ status, location });
						});
						request.on("response", () => {
							if (settled) return;
							settled = true;
							cleanup();
							request.abort();
							resolve(null);
						});
						request.on("error", (error) => {
							if (settled) return;
							settled = true;
							cleanup();
							reject(error);
						});
						init.signal?.addEventListener("abort", abort, { once: true });
						if (init.signal?.aborted) abort();
						else request.end();
					});
		init.signal?.throwIfAborted();
		discoveries.set(key, { expires: Date.now() + 30_000, redirect });
		while (discoveries.size > 64) discoveries.delete(discoveries.keys().next().value!);
		if (redirect) return new Response(null, { status: redirect.status, headers: { location: redirect.location } });
		try {
			const response = await updateSession.fetch(url, { ...init, redirect: "error", credentials: "omit" });
			if (response.status >= 400) discoveries.clear();
			return response;
		} catch (error) {
			// Redirects may change or signed CDN URLs may expire during retries.
			discoveries.clear();
			throw error;
		}
	};
}
export const fetchUpdatePackage = createDownloadFetch();
