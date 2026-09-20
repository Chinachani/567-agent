export interface Api567GroupInfo {
	name: string;
	desc: string;
	ratio: number;
	enabled: boolean;
	modelsCount?: number;
}

export interface Api567Status {
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	apiKeyMasked?: string;
	quota?: number;
	quotaUsd?: number;
	activeGroup?: string;
	groups?: Api567GroupInfo[];
	availableGroups?: Record<string, { desc: string; ratio: number }>;
	lastUpdated?: string;
	modelsCount?: number;
}

export interface Api567Api {
	getStatus(): Promise<Api567Status>;
	getAvailableGroups(): Promise<Record<string, { desc: string; ratio: number }>>;
	syncGroup(groupName: string): Promise<{ success: boolean; groupInfo?: Api567GroupInfo; message?: string }>;
	removeGroup(groupName: string): Promise<{ success: boolean; message?: string }>;
	setActiveGroup(groupName: string): Promise<{ success: boolean; message?: string }>;
	loginWithAccessToken(token: string): Promise<{ success: boolean; message?: string }>;
	loginWithPassword(credentials: {
		username: string;
		password: string;
	}): Promise<{ success: boolean; message?: string }>;
	login(credentials: { username: string; password: string }): Promise<{ success: boolean; message?: string }>;
	bindToken(token: string): Promise<{ success: boolean; message?: string }>;
	refreshQuota(): Promise<{ success: boolean; quota?: number; quotaUsd?: number }>;
	logout(): Promise<{ success: boolean }>;
	onStatusChanged(handler: (status: Api567Status) => void): () => void;
}
