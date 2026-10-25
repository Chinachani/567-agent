import type { Api567Status } from "@preload/api-types/567api";
import { i18n } from "@shared/i18n";
import { showToast } from "@shared/store/toast-atoms";
import { useAtom, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
	api567AuthModalOpenAtom,
	api567AvailableGroupsAtom,
	api567GroupsLoadStateAtom,
	api567InitialCheckDoneAtom,
	api567StatusAtom,
	api567TopupModalOpenAtom,
} from "../store/api567-atoms";

export function useApi567() {
	const [status, setStatus] = useAtom(api567StatusAtom);
	const [availableGroups, setAvailableGroups] = useAtom(api567AvailableGroupsAtom);
	const [initialCheckDone, setInitialCheckDone] = useAtom(api567InitialCheckDoneAtom);
	const [modalOpen, setModalOpen] = useAtom(api567AuthModalOpenAtom);
	const [topupModalOpen, setTopupModalOpen] = useAtom(api567TopupModalOpenAtom);
	const [loading, setLoading] = useState(false);
	const store = useStore();
	const [groupsLoadState, setGroupsLoadState] = useAtom(api567GroupsLoadStateAtom);

	const applyStatus = useCallback(
		(next: Api567Status) => {
			const previous = store.get(api567StatusAtom);
			const changed =
				previous.isLoggedIn !== next.isLoggedIn ||
				(previous.loginUsername ?? previous.username) !== (next.loginUsername ?? next.username);
			setStatus(next);
			if (changed) {
				setAvailableGroups(next.availableGroups ?? {});
				setGroupsLoadState((state) => ({
					request: state.request + 1,
					loading: false,
					loaded: Object.keys(next.availableGroups ?? {}).length > 0,
					error: false,
				}));
			} else if (next.availableGroups !== undefined) setAvailableGroups(next.availableGroups);
		},
		[setStatus, setAvailableGroups, setGroupsLoadState, store],
	);

	const loadAvailableGroups = useCallback(
		async (force = false) => {
			if (!window.agent567?.api567?.getAvailableGroups) return;
			const previous = store.get(api567GroupsLoadStateAtom);
			if ((previous.loading || previous.loaded) && !force) return;
			const request = previous.request + 1;
			const identity = store.get(api567StatusAtom);
			setGroupsLoadState({ loading: true, loaded: previous.loaded, error: false, request });
			const current = () =>
				store.get(api567GroupsLoadStateAtom).request === request &&
				store.get(api567StatusAtom).isLoggedIn === identity.isLoggedIn &&
				store.get(api567StatusAtom).loginUsername === identity.loginUsername;
			try {
				const groups = await window.agent567.api567.getAvailableGroups(force);
				if (!current()) return;
				setAvailableGroups(groups ?? {});
				setGroupsLoadState({ loading: false, loaded: true, error: false, request });
			} catch {
				if (!current()) return;
				setGroupsLoadState({ loading: false, loaded: true, error: true, request });
				if (force) showToast({ variant: "error", message: i18n.t("settings:api567Feedback.groupsFailed") });
			} finally {
				setGroupsLoadState((state) => (state.request === request ? { ...state, loading: false } : state));
			}
		},
		[setAvailableGroups, setGroupsLoadState, store],
	);

	useEffect(() => {
		let isMounted = true;
		if (!window.agent567?.api567) {
			setInitialCheckDone(true);
			return;
		}

		window.agent567.api567
			.getStatus()
			.then((initialStatus) => {
				if (isMounted) {
					applyStatus(initialStatus);
					setInitialCheckDone(true);
					if (initialStatus.availableGroups && Object.keys(initialStatus.availableGroups).length > 0) {
						setAvailableGroups(initialStatus.availableGroups);
					}
					if (initialStatus.isLoggedIn) {
						if (!initialStatus.availableGroups || Object.keys(initialStatus.availableGroups).length === 0) {
							void loadAvailableGroups(false);
						}
						if (initialStatus.quota === undefined) {
							void window.agent567.api567
								.refreshQuota(false)
								.then(async (res) => {
									if (res.success && isMounted) {
										const latest = await window.agent567.api567.getStatus();
										applyStatus(latest);
									}
								})
								.catch(() => undefined);
						}
					}
				}
			})
			.catch((err) => {
				console.error("Failed to get initial 567api status:", err);
				if (isMounted) {
					setInitialCheckDone(true);
				}
			});

		const unsubscribe = window.agent567.api567.onStatusChanged((newStatus) => {
			if (isMounted) {
				applyStatus(newStatus);
			}
		});

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [applyStatus, setInitialCheckDone, loadAvailableGroups, setAvailableGroups]);

	const loginWithAccessToken = useCallback(
		async (token: string): Promise<{ success: boolean; message?: string }> => {
			if (!token.trim()) {
				return { success: false, message: i18n.t("settings:api567Messages.emptyToken") };
			}
			setLoading(true);
			try {
				const res = await window.agent567.api567.loginWithAccessToken(token.trim());
				if (res.success) {
					showToast({
						variant: "success",
						title: i18n.t("settings:api567Messages.tokenSuccess"),
						message: i18n.t("settings:api567Messages.connected"),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: i18n.t("settings:api567Messages.loginFailed"),
						message: res.message || i18n.t("settings:api567Messages.tokenFailed"),
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({
					variant: "error",
					title: i18n.t("settings:api567Messages.loginException"),
					message: msg,
				});
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[applyStatus, loadAvailableGroups],
	);

	const loginWithPassword = useCallback(
		async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
			if (!username.trim() || !password.trim()) {
				return { success: false, message: i18n.t("settings:api567Messages.emptyCredentials") };
			}
			setLoading(true);
			try {
				const res = await window.agent567.api567.loginWithPassword({
					username: username.trim(),
					password: password.trim(),
				});
				if (res.success) {
					showToast({
						variant: "success",
						title: i18n.t("settings:api567Messages.loginSuccess"),
						message: i18n.t("settings:api567Messages.welcome", { name: username }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: i18n.t("settings:api567Messages.loginFailed"),
						message: res.message || i18n.t("settings:api567Messages.credentialsInvalid"),
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({
					variant: "error",
					title: i18n.t("settings:api567Messages.loginException"),
					message: msg,
				});
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[applyStatus, loadAvailableGroups],
	);

	const syncGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.agent567.api567.syncGroup(groupName);
				if (res.success) {
					showToast({
						variant: "success",
						title: i18n.t("settings:api567Messages.groupSuccess"),
						message: i18n.t("settings:api567Messages.groupConnected", { name: groupName }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				} else {
					showToast({
						variant: "error",
						title: i18n.t("settings:api567Messages.groupFailed"),
						message: res.message || i18n.t("settings:api567Messages.connectFailed"),
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({
					variant: "error",
					message: msg,
				});
				return { success: false, message: msg };
			}
		},
		[applyStatus],
	);

	const removeGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.agent567.api567.removeGroup(groupName);
				if (res.success) {
					showToast({
						variant: "info",
						message: i18n.t("settings:api567Messages.groupRemoved", { name: groupName }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				}
				if (!res.success)
					showToast({ variant: "error", message: res.message || i18n.t("settings:api567Feedback.removeFailed") });
				return res;
			} catch (err) {
				console.error("Failed to remove group:", err);
				showToast({ variant: "error", message: i18n.t("settings:api567Feedback.removeFailed") });
				return { success: false };
			}
		},
		[applyStatus],
	);

	const setActiveGroup = useCallback(
		async (groupName: string, modelName?: string) => {
			try {
				const res = await window.agent567.api567.setActiveGroup(groupName, modelName);
				if (res.success) {
					showToast({
						variant: "success",
						message: modelName
							? i18n.t("settings:api567Models.primarySaved", { model: modelName })
							: i18n.t("settings:api567Messages.primary", { name: groupName }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				}
				if (!res.success)
					showToast({ variant: "error", message: res.message || i18n.t("settings:api567Feedback.activeFailed") });
				return res;
			} catch (err) {
				console.error("Failed to set active group:", err);
				showToast({ variant: "error", message: i18n.t("settings:api567Feedback.activeFailed") });
				return { success: false };
			}
		},
		[applyStatus],
	);

	const setImageGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.agent567.api567.setImageGroup(groupName);
				if (res.success) {
					showToast({
						variant: "success",
						message: i18n.t("settings:api567Messages.imageGroup", { name: groupName }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				}
				if (!res.success)
					showToast({
						variant: "error",
						message: res.message || i18n.t("settings:api567Feedback.imageGroupFailed"),
					});
				return res;
			} catch (err) {
				console.error("Failed to set image group:", err);
				showToast({ variant: "error", message: i18n.t("settings:api567Feedback.imageGroupFailed") });
				return { success: false };
			}
		},
		[applyStatus],
	);

	const setImageModel = useCallback(
		async (modelName: string) => {
			try {
				const res = await window.agent567.api567.setImageModel(modelName);
				if (res.success) {
					showToast({
						variant: "success",
						message: i18n.t("settings:api567Messages.imageModel", { name: modelName }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				}
				if (!res.success)
					showToast({
						variant: "error",
						message: res.message || i18n.t("settings:api567Feedback.imageModelFailed"),
					});
				return res;
			} catch (err) {
				console.error("Failed to set image model:", err);
				showToast({ variant: "error", message: i18n.t("settings:api567Feedback.imageModelFailed") });
				return { success: false };
			}
		},
		[applyStatus],
	);

	const refreshGroups = useCallback(async () => {
		try {
			if (window.agent567?.api567?.refreshGroups) {
				const result = await window.agent567.api567.refreshGroups();
				if (!result.success) {
					showToast({ variant: "error", message: i18n.t("settings:api567Feedback.groupsFailed") });
					return;
				}
			}
			const latest = await window.agent567.api567.getStatus();
			applyStatus(latest);
		} catch (err) {
			console.error("Failed to refresh groups:", err);
			showToast({ variant: "error", message: i18n.t("settings:api567Feedback.groupsFailed") });
		}
	}, [applyStatus]);

	const refreshQuota = useCallback(
		async (force = false, silent = false): Promise<{ success: boolean; quota?: number; quotaUsd?: number }> => {
			try {
				const res = await window.agent567.api567.refreshQuota(force);
				if (res.success) {
					if (!silent) {
						showToast({
							variant: "success",
							title: i18n.t("settings:api567Messages.quotaSuccess"),
							message: i18n.t("settings:api567Messages.quota", {
								amount: res.quotaUsd !== undefined ? res.quotaUsd.toFixed(2) : "0.00",
							}),
						});
					}
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
					return res;
				} else {
					if (!silent) {
						showToast({
							variant: "warning",
							message: i18n.t("settings:api567Messages.quotaFailed"),
						});
					}
					return res;
				}
			} catch (err) {
				console.error("Failed to refresh quota:", err);
				if (!silent) showToast({ variant: "error", message: i18n.t("settings:api567Feedback.quotaFailed") });
				return { success: false };
			}
		},
		[applyStatus],
	);

	const sendVerificationCode = useCallback(async (email: string) => {
		if (!email.trim()) {
			showToast({ variant: "error", message: i18n.t("settings:api567Messages.emailInvalid") });
			return { success: false, message: i18n.t("settings:api567Messages.emailInvalid") };
		}
		try {
			const res = await window.agent567.api567.sendVerificationCode(email.trim());
			if (res.success) {
				showToast({
					variant: "success",
					title: i18n.t("settings:api567Messages.codeSent"),
					message: i18n.t("settings:api567Messages.checkEmail"),
				});
			} else {
				showToast({
					variant: "error",
					title: i18n.t("settings:api567Messages.sendFailed"),
					message: res.message || i18n.t("settings:api567Messages.codeFailed"),
				});
			}
			return res;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			showToast({ variant: "error", message: msg });
			return { success: false, message: msg };
		}
	}, []);

	const register = useCallback(
		async (params: {
			username: string;
			password: string;
			email: string;
			verification_code: string;
			aff_code?: string;
		}) => {
			setLoading(true);
			try {
				const res = await window.agent567.api567.register(params);
				if (res.success) {
					showToast({
						variant: "success",
						title: i18n.t("settings:api567Messages.registerSuccess"),
						message: i18n.t("settings:api567Messages.registered", { name: params.username }),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: i18n.t("settings:api567Messages.registerFailed"),
						message: res.message || i18n.t("settings:api567Messages.registerInvalid"),
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({ variant: "error", title: i18n.t("settings:api567Messages.registerException"), message: msg });
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[applyStatus, loadAvailableGroups],
	);

	const topupWithKey = useCallback(
		async (key: string) => {
			if (!key.trim()) {
				showToast({ variant: "error", message: i18n.t("settings:api567Messages.keyRequired") });
				return { success: false, message: i18n.t("settings:api567Messages.keyRequired") };
			}
			setLoading(true);
			try {
				const res = await window.agent567.api567.topupWithKey(key.trim());
				if (res.success) {
					showToast({
						variant: "success",
						title: i18n.t("settings:api567Messages.topupSuccess"),
						message: res.message || i18n.t("settings:api567Messages.redeemed"),
					});
					const latest = await window.agent567.api567.getStatus();
					applyStatus(latest);
				} else {
					showToast({
						variant: "error",
						title: i18n.t("settings:api567Messages.redeemFailed"),
						message: res.message || i18n.t("settings:api567Messages.invalidKey"),
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({ variant: "error", message: msg });
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[applyStatus],
	);

	const createPayOrder = useCallback(async (amount: number, method: "alipay" | "wxpay") => {
		try {
			return await window.agent567.api567.createPayOrder(amount, method);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			showToast({ variant: "error", title: i18n.t("settings:api567Messages.orderFailed"), message: msg });
			return { success: false, message: msg };
		}
	}, []);

	const logout = useCallback(async () => {
		try {
			await window.agent567.api567.logout();
			applyStatus({ isLoggedIn: false });
			showToast({
				variant: "info",
				message: i18n.t("settings:api567Messages.loggedOut"),
			});
		} catch (err) {
			console.error("Failed to logout:", err);
			showToast({ variant: "error", message: i18n.t("settings:api567Feedback.logoutFailed") });
		}
	}, [applyStatus]);

	return {
		status,
		availableGroups,
		groupsLoadState,
		loadAvailableGroups,
		initialCheckDone,
		loading,
		modalOpen,
		setModalOpen,
		topupModalOpen,
		setTopupModalOpen,
		sendVerificationCode,
		register,
		topupWithKey,
		createPayOrder,
		loginWithAccessToken,
		loginWithPassword,
		syncGroup,
		removeGroup,
		setActiveGroup,
		setImageGroup,
		setImageModel,
		refreshGroups,
		refreshQuota,
		logout,
	};
}
