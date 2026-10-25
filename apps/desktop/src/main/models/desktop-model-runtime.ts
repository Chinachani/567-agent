import {
	type CodingAgentAuthRuntime,
	type CodingAgentModelRuntime,
	createCodingAgentModelRuntime,
} from "@567agent/coding-agent/host-services";
import { nodeConfigurationValueResolver, nodeSyncTextFileSource } from "@567agent/runtime-node/host";
import { api567RouteOrigin } from "../../shared/service-routes.js";
import { getApi567RouteStore } from "../567api/service-route-store.js";
import { normalizeModelsConfig } from "./model-settings-service.js";

/** Desktop and its Electron RPC children share routing, never a live turn binding. */
export function createDesktopModelRuntime(
	auth: CodingAgentAuthRuntime,
	modelsJsonPath: string,
): CodingAgentModelRuntime {
	const routes = getApi567RouteStore();
	let loadedRoute = routes.selectedRoute;
	const runtime = createCodingAgentModelRuntime(auth, {
		modelsJsonPath,
		configFileSource: {
			exists: (path) => nodeSyncTextFileSource.exists(path),
			read: (path) => {
				const route = routes.route;
				const config = JSON.stringify(
					normalizeModelsConfig(
						JSON.parse(nodeSyncTextFileSource.read(path)),
						api567RouteOrigin(route),
						routes.trustedOrigins,
					),
				);
				loadedRoute = route;
				return config;
			},
		},
		configurationValueResolver: nodeConfigurationValueResolver,
	});
	const refresh = () => {
		loadedRoute = routes.selectedRoute;
		runtime.refresh();
	};
	const ensureRoute = () => {
		if (routes.selectedRoute !== loadedRoute) refresh();
	};
	return {
		refresh,
		find: (provider, id) => {
			ensureRoute();
			return runtime.find(provider, id);
		},
		getAll: () => {
			ensureRoute();
			return runtime.getAll();
		},
		getAvailable: () => {
			ensureRoute();
			return runtime.getAvailable();
		},
		getError: () => runtime.getError(),
		isRemote: (model) => runtime.isRemote(model),
		getRemoteProviders: () => runtime.getRemoteProviders(),
		getApiKey: (model) => runtime.getApiKey(model),
		getApiKeyForProvider: (provider) => runtime.getApiKeyForProvider(provider),
		isUsingOAuth: (model) => runtime.isUsingOAuth(model),
		registerProvider: (provider, config) => runtime.registerProvider(provider, config),
		setServerUrl: (url) => runtime.setServerUrl(url),
		setServerToken: (token) => runtime.setServerToken(token),
		setServerTokenGetter: (getter) => runtime.setServerTokenGetter(getter),
		loadRemoteModels: () => runtime.loadRemoteModels(),
	};
}
