import { showToast } from "@shared/store/toast-atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
	api567AuthModalOpenAtom,
	api567AvailableGroupsAtom,
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

		// 1. 每 60 秒自动静默轮询最新可用额度
		const interval = setInterval(() => {
			if (isMounted && document.visibilityState === "visible") {
				void window.vetta.api567.refreshQuota(false);
			}
		}, 60_000);

		// 2. 窗口重新聚焦时自动刷新
		const onFocus = () => {
			if (isMounted) {
				void window.vetta.api567.refreshQuota(false);
			}
		};
		window.addEventListener("focus", onFocus);

		return () => {
			isMounted = false;
			clearInterval(interval);
			window.removeEventListener("focus", onFocus);
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

	const setImageGroup = useCallback(
		async (groupName: string) => {
			try {
				const res = await window.vetta.api567.setImageGroup(groupName);
				if (res.success) {
					showToast({
						variant: "success",
						message: `画图分组已设置为: ${groupName}`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				}
				return res;
			} catch (err) {
				console.error("Failed to set image group:", err);
				return { success: false };
			}
		},
		[setStatus],
	);

	const setImageModel = useCallback(
		async (modelName: string) => {
			try {
				const res = await window.vetta.api567.setImageModel(modelName);
				if (res.success) {
					showToast({
						variant: "success",
						message: `画图模型已设置为: ${modelName}`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				}
				return res;
			} catch (err) {
				console.error("Failed to set image model:", err);
				return { success: false };
			}
		},
		[setStatus],
	);

	const refreshGroups = useCallback(async () => {
		try {
			if (window.vetta?.api567?.refreshGroups) {
				await window.vetta.api567.refreshGroups();
			}
			const latest = await window.vetta.api567.getStatus();
			setStatus(latest);
		} catch (err) {
			console.error("Failed to refresh groups:", err);
		}
	}, [setStatus]);

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

	const sendVerificationCode = useCallback(async (email: string) => {
		if (!email.trim()) {
			showToast({ variant: "error", message: "请输入有效的邮箱地址" });
			return { success: false, message: "请输入有效的邮箱地址" };
		}
		try {
			const res = await window.vetta.api567.sendVerificationCode(email.trim());
			if (res.success) {
				showToast({ variant: "success", title: "验证码已发送", message: "请查看您的邮箱并输入验证码" });
			} else {
				showToast({ variant: "error", title: "发送失败", message: res.message || "验证码发送失败" });
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
				const res = await window.vetta.api567.register(params);
				if (res.success) {
					showToast({
						variant: "success",
						title: "567 API 注册成功",
						message: `欢迎加入，${params.username}！已为您自动登录并配置初始模型。`,
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
					void loadAvailableGroups();
				} else {
					showToast({
						variant: "error",
						title: "注册失败",
						message: res.message || "注册信息有误，请核对后重试",
					});
				}
				return res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				showToast({ variant: "error", title: "注册异常", message: msg });
				return { success: false, message: msg };
			} finally {
				setLoading(false);
			}
		},
		[setStatus, loadAvailableGroups],
	);

	const topupWithKey = useCallback(
		async (key: string) => {
			if (!key.trim()) {
				showToast({ variant: "error", message: "请输入充值卡密兑换码" });
				return { success: false, message: "请输入充值卡密兑换码" };
			}
			setLoading(true);
			try {
				const res = await window.vetta.api567.topupWithKey(key.trim());
				if (res.success) {
					showToast({
						variant: "success",
						title: "充值成功",
						message: res.message || "卡密兑换成功，额度已实时到账！",
					});
					const latest = await window.vetta.api567.getStatus();
					setStatus(latest);
				} else {
					showToast({
						variant: "error",
						title: "兑换失败",
						message: res.message || "卡密兑换失败，请检查卡密有效性",
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
		[setStatus],
	);

	const createPayOrder = useCallback(async (amount: number, method: "alipay" | "wxpay") => {
		try {
			return await window.vetta.api567.createPayOrder(amount, method);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			showToast({ variant: "error", title: "订单创建失败", message: msg });
			return { success: false, message: msg };
		}
	}, []);

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
