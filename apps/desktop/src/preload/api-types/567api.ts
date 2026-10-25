import type { Api567RouteCatalog, Api567RouteId, Api567RouteProbe } from "../../shared/service-routes.js";

export interface Api567GroupInfo {
	name: string;
	desc: string;
	ratio: number;
	enabled: boolean;
	modelsCount?: number;
	models?: string[];
	imageModels?: string[];
}

export interface Api567Status {
	serviceRouteError?: boolean;
	serviceRoute?: Api567RouteId;
	serviceRoutes?: Api567RouteCatalog;
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	loginUsername?: string;
	apiKeyMasked?: string;
	quota?: number;
	quotaUsd?: number;
	activeGroup?: string;
	activeModel?: string;
	imageGroup?: string;
	imageModel?: string;
	groups?: Api567GroupInfo[];
	availableGroups?: Record<string, { desc: string; ratio: number }>;
	lastUpdated?: string;
	modelsCount?: number;
}

export interface Api567Api {
	refreshServiceRoutes(force?: boolean): Promise<Api567RouteCatalog>;
	probeServiceRoute(route: Api567RouteId, requestId: string): Promise<Api567RouteProbe>;
	selectServiceRoute(route: Api567RouteId, requestId: string): Promise<Api567RouteProbe>;
	cancelServiceRouteRequest(requestId: string): Promise<void>;
	getStatus(): Promise<Api567Status>;
	getAvailableGroups(force?: boolean): Promise<Record<string, { desc: string; ratio: number }>>;
	syncGroup(groupName: string): Promise<{ success: boolean; groupInfo?: Api567GroupInfo; message?: string }>;
	removeGroup(groupName: string): Promise<{ success: boolean; message?: string }>;
	setActiveGroup(groupName: string, modelName?: string): Promise<{ success: boolean; message?: string }>;
	setImageGroup(groupName: string): Promise<{ success: boolean; message?: string }>;
	setImageModel(modelName: string): Promise<{ success: boolean; message?: string }>;
	loginWithAccessToken(token: string): Promise<{ success: boolean; message?: string }>;
	loginWithPassword(credentials: {
		username: string;
		password: string;
	}): Promise<{ success: boolean; message?: string }>;
	login(credentials: { username: string; password: string }): Promise<{ success: boolean; message?: string }>;
	sendVerificationCode(email: string): Promise<{ success: boolean; message?: string }>;
	register(params: {
		username: string;
		password: string;
		email: string;
		verification_code: string;
		aff_code?: string;
	}): Promise<{ success: boolean; message?: string }>;
	topupWithKey(key: string): Promise<{ success: boolean; message?: string }>;
	createPayOrder(
		amount: number,
		paymentMethod: "alipay" | "wxpay",
	): Promise<{
		success: boolean;
		payUrl?: string;
		qrCode?: string;
		message?: string;
		errorCode?: "payment_unavailable";
	}>;
	bindToken(token: string): Promise<{ success: boolean; message?: string }>;
	refreshQuota(force?: boolean): Promise<{ success: boolean; quota?: number; quotaUsd?: number }>;
	refreshGroups(): Promise<{ success: boolean }>;
	logout(): Promise<{ success: boolean }>;
	onStatusChanged(handler: (status: Api567Status) => void): () => void;
}
