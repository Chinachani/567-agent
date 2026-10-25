import { type Api, type Model, type SimpleStreamFunction, type SimpleStreamOptions, streamSimple } from "@567agent/ai";
import { getBuiltinApi567Route } from "../../shared/service-routes.js";
import { mainT } from "../i18n/messages.js";
import { getSecurityHeaders } from "./request-signing.js";
import { getApi567RouteStore } from "./service-route-store.js";

/** Bind the destination and group to this model call, but generate proof for every HTTP attempt. */
export function withApi567InferenceOptions(
	model: Model<Api>,
	options?: SimpleStreamOptions,
): SimpleStreamOptions | undefined {
	if (model.provider !== "567api" && !model.provider.startsWith("567api_")) return options;
	const endpoint = model.gatewayUrl ?? model.baseUrl;
	if (!getBuiltinApi567Route(endpoint, getApi567RouteStore().trustedOrigins)) return options;
	const group = Object.entries(model.headers ?? {}).find(([name]) => name.toLowerCase() === "x-567-group")?.[1];
	if (group === undefined) return options;
	const origin = new URL(endpoint).origin;
	const send = options?.fetch ?? globalThis.fetch;
	return {
		...options,
		fetch: async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith("/v1/")) {
				throw new Error(mainT("api567Credentials.destinationChanged"));
			}
			const headers = new Headers(input instanceof Request ? input.headers : undefined);
			new Headers(init?.headers).forEach((value, key) => {
				headers.set(key, value);
			});
			for (const [key, value] of Object.entries(getSecurityHeaders({ "X-567-Group": group })))
				headers.set(key, value);
			// Native redirects would forward these custom headers without returning through this signer.
			return send(input, { ...init, headers, redirect: "error" });
		},
	};
}

export function createApi567InferenceStream(downstream: SimpleStreamFunction = streamSimple): SimpleStreamFunction {
	return (model, context, options) => downstream(model, context, withApi567InferenceOptions(model, options));
}
