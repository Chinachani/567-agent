import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	CreditCard,
	ExternalLink,
	Globe,
	Loader2,
	QrCode,
	RefreshCw,
	Scan,
	Sparkles,
	Wallet,
	X,
} from "lucide-react";
import QRCode from "qrcode";
import React, { useEffect, useState } from "react";
import { useApi567 } from "../hooks/useApi567";

const QUICK_AMOUNTS = [10, 20, 50, 100, 200];

export function Api567TopupModal(): JSX.Element | null {
	const {
		status,
		topupModalOpen,
		setTopupModalOpen,
		topupWithKey,
		createPayOrder,
		refreshQuota,
		loading,
	} = useApi567();

	const [activeTab, setActiveTab] = useState<"online" | "card">("online");
	const [paymentMethod, setPaymentMethod] = useState<"alipay" | "wxpay">("alipay");
	const [amount, setAmount] = useState<number>(20);
	const [customAmount, setCustomAmount] = useState<string>("");
	const [cardKey, setCardKey] = useState("");

	// 支付视图状态："input" 表单 | "qrcode" 原生付款码 | "iframe" 内置收银台兜底 | "success" 支付成功
	const [payView, setPayView] = useState<"input" | "qrcode" | "iframe" | "success">("input");
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
	const [paidAmount, setPaidAmount] = useState<number>(20);
	const [initialQuota, setInitialQuota] = useState<number | null>(null);

	const [paying, setPaying] = useState(false);
	const [refreshingQuota, setRefreshingQuota] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// 轮询余额变动：在付款码或收银台视图下，每 2 秒静默检测到账
	useEffect(() => {
		if (!topupModalOpen || (payView !== "qrcode" && payView !== "iframe") || initialQuota === null) return;
		const timer = setInterval(async () => {
			const res = await refreshQuota(true, true);
			if (res.success && res.quotaUsd !== undefined && res.quotaUsd > initialQuota + 0.001) {
				setPayView("success");
				clearInterval(timer);
				setTimeout(() => {
					setTopupModalOpen(false);
					setPayView("input");
					setQrDataUrl(null);
					setFallbackUrl(null);
				}, 1800);
			}
		}, 2000);
		return () => clearInterval(timer);
	}, [topupModalOpen, payView, initialQuota, refreshQuota, setTopupModalOpen]);

	// 重置弹窗状态
	const handleClose = () => {
		setTopupModalOpen(false);
		setPayView("input");
		setErrorMsg(null);
		setQrDataUrl(null);
		setFallbackUrl(null);
	};

	if (!topupModalOpen) return null;

	const handlePaySubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		const finalAmount = customAmount ? Number(customAmount) : amount;
		if (Number.isNaN(finalAmount) || finalAmount < 1) {
			setErrorMsg("充值金额必须大于等于 1 元（仅支持整数）");
			return;
		}

		setPaying(true);
		setPaidAmount(finalAmount);
		setInitialQuota(status.quotaUsd ?? 0);

		try {
			const res = await createPayOrder(finalAmount, paymentMethod);
			if (!res.success) {
				setErrorMsg(res.message || "未能创建支付订单，请稍后重试");
				return;
			}

			// 优先尝试原生二维码渲染
			if (res.qrCode) {
				if (res.qrCode.startsWith("data:image/") || (res.qrCode.startsWith("http") && res.qrCode.includes(".png"))) {
					setQrDataUrl(res.qrCode);
				} else {
					try {
						const dataUrl = await QRCode.toDataURL(res.qrCode, {
							width: 260,
							margin: 1,
							errorCorrectionLevel: "M",
						});
						setQrDataUrl(dataUrl);
					} catch (qrErr) {
						console.warn("QRCode generation failed, fallback to url:", qrErr);
						setQrDataUrl(null);
					}
				}
				if (res.payUrl) setFallbackUrl(res.payUrl);
				setPayView("qrcode");
			} else if (res.payUrl) {
				// 二维码提取未命中，优雅走方案 3：内置收银台 iframe 兜底
				setFallbackUrl(res.payUrl);
				setPayView("iframe");
			} else {
				setErrorMsg("支付服务未返回有效的付款链接，请稍后重试");
			}
		} finally {
			setPaying(false);
		}
	};

	const handleCardSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		const clean = cardKey.trim();
		if (!clean) {
			setErrorMsg("请输入充值卡密");
			return;
		}
		const res = await topupWithKey(clean);
		if (res.success) {
			setCardKey("");
			setPayView("success");
			setTimeout(() => {
				setTopupModalOpen(false);
				setPayView("input");
			}, 1500);
		} else {
			setErrorMsg(res.message || "卡密兑换失败，请确认卡密有效后重试");
		}
	};

	const handleManualRefresh = async () => {
		setRefreshingQuota(true);
		try {
			const res = await refreshQuota(true, true);
			if (res.success && res.quotaUsd !== undefined && initialQuota !== null && res.quotaUsd > initialQuota + 0.001) {
				setPayView("success");
				setTimeout(() => {
					setTopupModalOpen(false);
					setPayView("input");
				}, 1500);
			}
		} finally {
			setRefreshingQuota(false);
		}
	};

	const openExternal = (url: string) => {
		if (window.vetta?.shell?.openExternal) {
			void window.vetta.shell.openExternal(url);
		} else {
			window.open(url, "_blank");
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 shadow-2xl">
				{/* 顶栏关闭与状态 */}
				<div className="flex items-center justify-between border-b pb-4">
					<div className="flex items-center gap-2">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Wallet className="h-4 w-4" />
						</div>
						<div>
							<h3 className="font-semibold text-sm text-foreground">账户额度充值</h3>
							<p className="text-[11px] text-muted-foreground">
								当前可用余额:{" "}
								<span className="font-bold text-emerald-600 dark:text-emerald-400">
									${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
								</span>
							</p>
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleClose}
						className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>

				{/* 错误提示条 */}
				{errorMsg && (
					<div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
						{errorMsg}
					</div>
				)}

				{/* 未登录警告 */}
				{!status.isLoggedIn && (
					<div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
						提示：当前尚未登录 567 API 账户，请先在登录界面完成登录或注册，登录后即可为当前账户充值额度。
					</div>
				)}

				{/* ---------------- 1. 支付成功状态 ---------------- */}
				{payView === "success" && (
					<div className="my-8 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-200">
						<CheckCircle2 className="h-16 w-16 text-emerald-500" />
						<h4 className="mt-3 font-bold text-base text-foreground">充值成功！</h4>
						<p className="mt-1 text-xs text-muted-foreground">
							额度已实时充入您的 567 API 账户
						</p>
						<div className="mt-4 rounded-xl bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
							最新账户余额: ${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
						</div>
					</div>
				)}

				{/* ---------------- 2. 原生付款码视图 (方案 1) ---------------- */}
				{payView === "qrcode" && qrDataUrl && (
					<div className="my-3 flex flex-col items-center text-center animate-in fade-in duration-150">
						<div className="flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1 text-xs font-medium text-foreground">
							{paymentMethod === "alipay" ? (
								<>
									<span className="font-bold text-blue-500">支</span>
									<span>请使用支付宝扫码支付</span>
								</>
							) : (
								<>
									<span className="font-bold text-emerald-500">微</span>
									<span>请使用微信扫码支付</span>
								</>
							)}
						</div>

						{/* 原生二维码呈现卡片 */}
						<div className="mt-3 relative rounded-2xl border border-border/80 bg-white p-3 shadow-md">
							<img
								src={qrDataUrl}
								alt="支付二维码"
								className="h-56 w-56 rounded-xl object-contain"
							/>
						</div>

						{/* 金额与状态 */}
						<div className="mt-3">
							<div className="font-bold text-lg text-foreground">
								¥{paidAmount}.00
							</div>
							<div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
								<Loader2 className="h-3 w-3 animate-spin text-primary" />
								<span>等待支付中，付款后将自动确认到账...</span>
							</div>
						</div>

						{/* 底部操作条 */}
						<div className="mt-4 flex w-full gap-2 border-t pt-3">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setPayView("input")}
								className="h-8 flex-1 gap-1 text-xs"
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								<span>返回重选</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={refreshingQuota}
								onClick={handleManualRefresh}
								className="h-8 gap-1 text-xs px-3"
								title="手动刷新余额"
							>
								<RefreshCw className={`h-3.5 w-3.5 ${refreshingQuota ? "animate-spin text-primary" : ""}`} />
								<span>已支付</span>
							</Button>
						</div>

						{/* 方案 3 内置收银台切换入口 */}
						{fallbackUrl && (
							<button
								type="button"
								onClick={() => setPayView("iframe")}
								className="mt-2 text-[11px] text-muted-foreground hover:text-primary transition-colors"
							>
								二维码无法识别？切换为内置收银台
							</button>
						)}
					</div>
				)}

				{/* ---------------- 3. 内置收银台兜底视图 (方案 3) ---------------- */}
				{payView === "iframe" && fallbackUrl && (
					<div className="my-2 flex flex-col animate-in fade-in duration-150">
						<div className="mb-2 flex items-center justify-between text-xs">
							<span className="font-medium text-muted-foreground">内置安全收银台</span>
							<button
								type="button"
								onClick={() => openExternal(fallbackUrl)}
								className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
							>
								<span>外部浏览器打开</span>
								<ExternalLink className="h-3 w-3" />
							</button>
						</div>
						<div className="h-80 w-full overflow-hidden rounded-xl border border-border/80 bg-white">
							<iframe
								src={fallbackUrl}
								title="收银台"
								className="h-full w-full border-0"
							/>
						</div>
						<div className="mt-3 flex items-center justify-between border-t pt-3">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setPayView("input")}
								className="h-8 gap-1 text-xs"
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								<span>返回更换</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={refreshingQuota}
								onClick={handleManualRefresh}
								className="h-8 gap-1 text-xs"
							>
								<RefreshCw className={`h-3.5 w-3.5 ${refreshingQuota ? "animate-spin text-primary" : ""}`} />
								<span>已支付，刷新余额</span>
							</Button>
						</div>
					</div>
				)}

				{/* ---------------- 4. 充值输入初始视图 ---------------- */}
				{payView === "input" && (
					<>
						{/* 方式选择选项卡 */}
						<div className="my-4 flex rounded-xl bg-muted/70 p-1 text-xs">
							<button
								type="button"
								className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all ${
									activeTab === "online"
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
								onClick={() => {
									setActiveTab("online");
									setErrorMsg(null);
								}}
							>
								<QrCode className="h-3.5 w-3.5" />
								<span>在线扫码充值</span>
							</button>
							<button
								type="button"
								className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all ${
									activeTab === "card"
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
								onClick={() => {
									setActiveTab("card");
									setErrorMsg(null);
								}}
							>
								<CreditCard className="h-3.5 w-3.5" />
								<span>卡密兑换码</span>
							</button>
						</div>

						{/* 在线扫码充值 Tab */}
						{activeTab === "online" ? (
							<form onSubmit={handlePaySubmit} className="space-y-4">
								{/* 支付方式 */}
								<div>
									<label className="mb-1.5 block font-medium text-xs text-foreground">支付渠道</label>
									<div className="grid grid-cols-2 gap-2">
										<button
											type="button"
											onClick={() => setPaymentMethod("alipay")}
											className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-medium transition-colors ${
												paymentMethod === "alipay"
													? "border-primary bg-primary/10 text-primary"
													: "border-border hover:bg-muted/30"
											}`}
										>
											<span className="font-bold text-blue-500">支</span>
											<span>支付宝</span>
											{paymentMethod === "alipay" && <Check className="h-3.5 w-3.5" />}
										</button>
										<button
											type="button"
											onClick={() => setPaymentMethod("wxpay")}
											className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-medium transition-colors ${
												paymentMethod === "wxpay"
													? "border-primary bg-primary/10 text-primary"
													: "border-border hover:bg-muted/30"
											}`}
										>
											<span className="font-bold text-emerald-500">微</span>
											<span>微信支付</span>
											{paymentMethod === "wxpay" && <Check className="h-3.5 w-3.5" />}
										</button>
									</div>
								</div>

								{/* 充值金额快速点选 */}
								<div>
									<div className="mb-1.5 flex items-center justify-between text-xs">
										<label className="font-medium text-foreground">充值金额 (CNY)</label>
										<span className="text-[11px] text-muted-foreground">1 元 = $1 账户额度</span>
									</div>
									<div className="grid grid-cols-3 gap-2">
										{QUICK_AMOUNTS.map((amt) => {
											const isSelected = !customAmount && amount === amt;
											return (
												<button
													key={amt}
													type="button"
													onClick={() => {
														setAmount(amt);
														setCustomAmount("");
													}}
													className={`flex flex-col items-center justify-center rounded-xl border py-2 text-xs font-medium transition-all ${
														isSelected
															? "border-primary bg-primary/10 text-primary font-bold"
															: "border-border hover:bg-muted/30"
													}`}
												>
													<span className="text-sm">¥{amt}</span>
													<span className="text-[10px] text-muted-foreground">到账 ${amt}</span>
												</button>
											);
										})}
										{/* 自定义金额 */}
										<div className="relative">
											<Input
												type="number"
												min="1"
												step="1"
												placeholder="自定义"
												value={customAmount}
												onChange={(e) => setCustomAmount(e.target.value)}
												className="h-full rounded-xl text-center text-xs"
											/>
										</div>
									</div>
								</div>

								<div className="pt-1">
									<Button
										type="submit"
										disabled={paying || !status.isLoggedIn}
										className="h-10 w-full gap-2 font-semibold"
									>
										{paying ? (
											<>
												<Loader2 className="h-4 w-4 animate-spin" />
												<span>正在生成付款码...</span>
											</>
										) : (
											<>
												<Scan className="h-4 w-4" />
												<span>生成付款码支付 ¥{customAmount || amount}</span>
											</>
										)}
									</Button>
								</div>
							</form>
						) : (
							/* 卡密兑换 Tab */
							<form onSubmit={handleCardSubmit} className="space-y-4">
								<div>
									<label className="mb-1.5 block font-medium text-xs text-foreground">充值卡密 / 兑换码</label>
									<Input
										type="text"
										placeholder="请输入 567 API 充值兑换码"
										value={cardKey}
										onChange={(e) => setCardKey(e.target.value)}
										disabled={loading}
										autoFocus
										required
										className="h-10 font-mono text-xs"
									/>
									<p className="mt-1.5 text-[11px] text-muted-foreground">
										兑换码通常由发卡平台或管理员提供。输入后点击兑换，额度将即刻全额充入当前账户。
									</p>
								</div>

								<Button
									type="submit"
									disabled={loading || !cardKey.trim() || !status.isLoggedIn}
									className="h-10 w-full gap-2 font-semibold"
								>
									{loading ? (
										<>
											<Loader2 className="h-4 w-4 animate-spin" />
											<span>正在核销兑换...</span>
										</>
									) : (
										<>
											<Sparkles className="h-4 w-4" />
											<span>立即核销并兑换额度</span>
										</>
									)}
								</Button>
							</form>
						)}
					</>
				)}
			</div>
		</div>
	);
}
