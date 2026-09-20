import { showToast } from "@shared/store/toast-atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
	api567AuthModalOpenAtom,
	api567AvailableGroupsAtom,
	api567InitialCheckDoneAtom,
	api567StatusAtom,
} from "../store/api567-atoms";

export function useApi567() {
	const [status, setStatus] = useAtom(api567StatusAtom);
	const [availableGroups, setAvailableGroups] = useAtom(api567AvailableGroupsAtom);
	const [initialCheckDone, setInitialCheckDone] = useAtom(api567InitialCheckDoneAtom);
	const [modalOpen, setModalOpen] = useAtom(api567AuthModalOpenAtom);
	const [loading, setLoading] = useState(false);

	const loadAvailableGroups = useCallback(
		async (force = false) => {
			if (!window.vetta?.api567?.getAvailableGroups) return;
			try {
				const groups = await window.vetta.api567.getAvailableGroups(force);
				if (groups && Object.keys(groups).length > 0) {
					setAvailableGroups(groups);
				}
			} catch (err) {
				console.error("Failed to load available groups:", err);
			}
		},
		[setAvailableGroups],
	);

	useEffect(() => {
		let isMounted = true;
		if (!window.vetta?.api567) {
			setInitialCheckDone(true);
			return;
		}

		window.vetta.api567
			.getStatus()
			.then((initialStatus) => {
				if (isMounted) {
					setStatus(initialStatus);
					setInitialCheckDone(true);
					if (initialStatus.availableGroups && Object.keys(initialStatus.availableGroups).length > 0) {
						setAvailableGroups(initialStatus.availableGroups);
					}
					if (initialStatus.isLoggedIn) {
						void loadAvailableGroups(false);
						// 静默使用缓存或按需刷新
						void window.vetta.api567.refreshQuota(false).then(async (res) => {
							if (res.success && isMounted) {
								const latest = await window.vetta.api567.getStatus();
								setStatus(latest);
							}
						});
					}
				}
			})
			.catch((err) => {
				console.error("Failed to get initial 567api status:", err);
				if (isMounted) {
					setInitialCheckDone(true);
				}
			});

		const unsubscribe = window.vetta.api567.onStatusChanged((newStatus) => {
			if (isMounted) {
				setStatus(newStatus);
				if (newStatus.isLoggedIn) {
					void loadAvailableGroups();
				}
			}
		});

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [setStatus, setInitialCheckDone, loadAvailableGroups, setAvailableGroups]);

	const loginWithAccessToken = useCallback(
		async (token: string): Promise<{ success: boolean; message?: string }> => {
			if (!token.trim()) {
				return { success: false, message: "账户访问令牌不能为空" };
			}
			setLoading(true);
			try {
				const res = await window.vetta.api567.loginWithAccessToken(token.trim());
				if (res.success) {
					showToast({
						variant: "success",
						title: "567 API 验证成功",
						message: "已成功连接 567 API，并根据分组自动接入模型配置！",
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: "登录失败",
						message: res.message || "账户访问令牌验证失败，请重试",
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({
					variant: "error",
					title: "登录发生异常",
					message: msg,
				});
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[setStatus, loadAvailableGroups],
	);

	const loginWithPassword = useCallback(
		async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
			if (!username.trim() || !password.trim()) {
				return { success: false, message: "用户名或密码不能为空" };
			}
			setLoading(true);
			try {
				const res = await window.vetta.api567.loginWithPassword({
					username: username.trim(),
					password: password.trim(),
				});
				if (res.success) {
					showToast({
						variant: "success",
						title: "567 API 登录成功",
						message: `欢迎回来，${username}！API 分组模型已自动接入。`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: "登录失败",
						message: res.message || "用户名或密码错误",
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({
					variant: "error",
					title: "登录发生异常",
					message: msg,
				});
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[setStatus, loadAvailableGroups],
	);

	const syncGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.vetta.api567.syncGroup(groupName);
				if (res.success) {
					showToast({
						variant: "success",
						title: "分组接入成功",
						message: `已为分组 [${groupName}] 自动关联密钥并同步模型`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				} else {
					showToast({
						variant: "error",
						title: "分组接入失败",
						message: res.message || "未能接入该分组",
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
		[setStatus],
	);

	const removeGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.vetta.api567.removeGroup(groupName);
				if (res.success) {
					showToast({
						variant: "info",
						message: `已移除分组 [${groupName}]`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				}
				return res;
			} catch (err) {
				console.error("Failed to remove group:", err);
				return { success: false };
			}
		},
		[setStatus],
	);

	const setActiveGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.vetta.api567.setActiveGroup(groupName);
				if (res.success) {
					showToast({
						variant: "success",
						message: `主力分组已切换为: ${groupName}`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				}
				return res;
			} catch (err) {
				console.error("Failed to set active group:", err);
				return { success: false };
			}
		},
		[setStatus],
	);

	const refreshQuota = useCallback(
		async (force = false) => {
			try {
				const res = await window.vetta.api567.refreshQuota(force);
				if (res.success) {
					showToast({
						variant: "success",
						title: "余额刷新成功",
						message: `当前可用额度: $${res.quotaUsd !== undefined ? res.quotaUsd.toFixed(2) : "0.00"}`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				} else {
					showToast({
						variant: "warning",
						message: "刷新余额失败，请稍后重试",
					});
				}
			} catch (err) {
				console.error("Failed to refresh quota:", err);
			}
		},
		[setStatus],
	);

	const logout = useCallback(async () => {
		try {
			await window.vetta.api567.logout();
			setStatus({ isLoggedIn: false });
			showToast({
				variant: "info",
				message: "已退出 567 API 账户",
			});
		} catch (err) {
			console.error("Failed to logout:", err);
		}
	}, [setStatus]);

	return {
		status,
		availableGroups,
		initialCheckDone,
		loading,
		modalOpen,
		setModalOpen,
		loginWithAccessToken,
		loginWithPassword,
		syncGroup,
		removeGroup,
		setActiveGroup,
		refreshQuota,
		logout,
	};
}
