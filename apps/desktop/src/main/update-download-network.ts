import { net, session } from "electron";
import type { UpdateFetch } from "./update-download.js";

/** Electron fetch rejects manual redirects. Probe one byte with net.request, then stream without redirects. */
export const fetchUpdatePackage: UpdateFetch = async (url, init) => {
	const updateSession = session.fromPartition("electron-updater", { cache: false });
	const redirect = await new Promise<{ status: number; location: string } | null>((resolve, reject) => {
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
	if (redirect) return new Response(null, { status: redirect.status, headers: { location: redirect.location } });
	return updateSession.fetch(url, { ...init, redirect: "error", credentials: "omit" });
};
