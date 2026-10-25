import { isPaymentUnavailable } from "@/shared/api567/payment-failure";
import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { createQrCodeDataUrl } from "@shared/lib/qr-code-data-url";
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
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi567 } from "../hooks/useApi567";

const QUICK_AMOUNTS = [10, 20, 50, 100, 200];
const PAYMENT_POLL_INTERVAL_MS = 5_000;
const PAYMENT_POLL_TIMEOUT_MS = 15 * 60_000;

export function Api567TopupModal(): JSX.Element | null {
	const { t } = useTranslation("common");
	const { status, topupModalOpen, setTopupModalOpen, topupWithKey, createPayOrder, refreshQuota, loading } =
		useApi567();

	const returnFocus = useRef<HTMLElement | null>(null);
	const generation = useRef(0);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		generation.current++;
		return () => {
			generation.current++;
			if (closeTimer.current) clearTimeout(closeTimer.current);
		};
	}, [topupModalOpen]);
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
	const [paymentStartedAt, setPaymentStartedAt] = useState<number | null>(null);
	const [paymentPollExpired, setPaymentPollExpired] = useState(false);

	const [paying, setPaying] = useState(false);
	const [refreshingQuota, setRefreshingQuota] = useState(false);
	const [onlineUnavailable, setOnlineUnavailable] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// 轮询余额变动；超时后停止后台请求，保留手动核对入口。
	useEffect(() => {
		if (
			!topupModalOpen ||
			(payView !== "qrcode" && payView !== "iframe") ||
			initialQuota === null ||
			paymentStartedAt === null ||
			paymentPollExpired
		)
			return;
		const remainingMs = Math.max(0, paymentStartedAt + PAYMENT_POLL_TIMEOUT_MS - Date.now());
		const timeout = setTimeout(() => setPaymentPollExpired(true), remainingMs);
		const request = generation.current;
		const timer = setInterval(async () => {
			const res = await refreshQuota(false, true);
			if (request !== generation.current) return;
			if (res.success && res.quotaUsd !== undefined && res.quotaUsd > initialQuota + 0.001) {
				setPayView("success");
				clearInterval(timer);
				clearTimeout(timeout);
				closeTimer.current = setTimeout(() => {
					if (request !== generation.current) return;
					setTopupModalOpen(false);
					setPayView("input");
					setQrDataUrl(null);
					setFallbackUrl(null);
					setPaymentStartedAt(null);
				}, 1800);
			}
		}, PAYMENT_POLL_INTERVAL_MS);
		return () => {
			clearTimeout(timeout);
			clearInterval(timer);
		};
	}, [topupModalOpen, payView, initialQuota, paymentStartedAt, paymentPollExpired, refreshQuota, setTopupModalOpen]);

	// 重置弹窗状态
	const handleClose = () => {
		generation.current++;
		if (closeTimer.current) clearTimeout(closeTimer.current);
		setPaying(false);
		setRefreshingQuota(false);
		setTopupModalOpen(false);
		setPayView("input");
		setErrorMsg(null);
		setOnlineUnavailable(false);
		setQrDataUrl(null);
		setFallbackUrl(null);
		setPaymentStartedAt(null);
		setPaymentPollExpired(false);
	};

	if (!topupModalOpen) return null;

	const handlePaySubmit = async (e: React.FormEvent) => {
		const request = generation.current;
		e.preventDefault();
		setErrorMsg(null);
		const finalAmount = customAmount ? Number(customAmount) : amount;
		if (!Number.isSafeInteger(finalAmount) || finalAmount < 1) {
			setErrorMsg(t("topupUi.invalidAmount"));
			return;
		}

		setPaying(true);
		setPaidAmount(finalAmount);

		try {
			const refreshedQuota = await refreshQuota(true, true);
			if (request !== generation.current) return;
			const quotaBeforePayment = refreshedQuota.success ? refreshedQuota.quotaUsd : undefined;
			if (quotaBeforePayment === undefined) {
				setErrorMsg(t("topupStatus.baselineUnavailable"));
				return;
			}
			setInitialQuota(quotaBeforePayment);
			setPaymentPollExpired(false);

			const res = await createPayOrder(finalAmount, paymentMethod);
			if (request !== generation.current) return;
			if (!res.success) {
				if (res.errorCode === "payment_unavailable" || isPaymentUnavailable(res.message ?? "")) {
					setOnlineUnavailable(true);
					return;
				}
				setErrorMsg(res.message || t("topupUi.orderFailed"));
				return;
			}

			// 优先尝试原生二维码渲染
			if (res.qrCode) {
				let generatedQr: string | null = null;
				if (
					res.qrCode.startsWith("data:image/") ||
					(res.qrCode.startsWith("http") && res.qrCode.includes(".png"))
				) {
					generatedQr = res.qrCode;
				} else {
					try {
						generatedQr = await createQrCodeDataUrl(res.qrCode, 260);
						if (request !== generation.current) return;
					} catch (qrErr) {
						console.warn("QRCode generation failed, fallback to url:", qrErr);
					}
				}
				if (res.payUrl) setFallbackUrl(res.payUrl);
				if (generatedQr) {
					setQrDataUrl(generatedQr);
					setPayView("qrcode");
				} else if (res.payUrl) {
					setQrDataUrl(null);
					setPayView("iframe");
				} else {
					setErrorMsg(t("topupStatus.qrUnavailable"));
				}
			} else if (res.payUrl) {
				// 二维码提取未命中，优雅走方案 3：内置收银台 iframe 兜底
				setFallbackUrl(res.payUrl);
				setPayView("iframe");
			} else {
				setErrorMsg(t("topupStatus.paymentUrlUnavailable"));
			}
			if (res.success && (res.qrCode || res.payUrl)) setPaymentStartedAt(Date.now());
		} catch (error) {
			if (request === generation.current)
				setErrorMsg(error instanceof Error ? error.message : t("topupStatus.orderFailed"));
		} finally {
			if (request === generation.current) setPaying(false);
		}
	};

	const handleCardSubmit = async (e: React.FormEvent) => {
		const request = generation.current;
		e.preventDefault();
		setErrorMsg(null);
		const clean = cardKey.trim();
		if (!clean) {
			setErrorMsg(t("topupUi.keyRequired"));
			return;
		}
		const res = await topupWithKey(clean);
		if (request !== generation.current) return;
		if (res.success) {
			setCardKey("");
			setPayView("success");
			closeTimer.current = setTimeout(() => {
				if (request !== generation.current) return;
				setTopupModalOpen(false);
				setPayView("input");
			}, 1500);
		} else {
			setErrorMsg(res.message || t("topupUi.redeemFailed"));
		}
	};

	const handleManualRefresh = async () => {
		const request = generation.current;
		setRefreshingQuota(true);
		try {
			const res = await refreshQuota(true, true);
			if (request !== generation.current) return;
			if (
				res.success &&
				res.quotaUsd !== undefined &&
				initialQuota !== null &&
				res.quotaUsd > initialQuota + 0.001
			) {
				setPayView("success");
				closeTimer.current = setTimeout(() => {
					if (request !== generation.current) return;
					setTopupModalOpen(false);
					setPayView("input");
				}, 1500);
			}
		} finally {
			if (request === generation.current) setRefreshingQuota(false);
		}
	};

	const openExternal = (url: string) => {
		if (window.agent567?.shell?.openExternal) {
			void window.agent567.shell.openExternal(url);
		} else {
			window.open(url, "_blank");
		}
	};

	return (
		<Dialog
			open={topupModalOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent
				onOpenAutoFocus={() => {
					returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (returnFocus.current?.isConnected) returnFocus.current.focus();
				}}
				showCloseButton={false}
				className="max-h-[85vh] max-w-md overflow-y-auto p-6"
			>
				{/* 顶栏关闭与状态 */}
				<div className="flex items-center justify-between border-b pb-4">
					<div className="flex items-center gap-2">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Wallet className="h-4 w-4" />
						</div>
						<div>
							<DialogTitle className="font-semibold text-sm text-foreground">{t("topupUi.title")}</DialogTitle>
							<DialogDescription className="text-[11px] text-muted-foreground">
								{t("topupUi.balance")}:{" "}
								<span className="font-bold text-foreground">
									${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
								</span>
							</DialogDescription>
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleClose}
						aria-label={t("actions.close")}
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
					<div className="mt-3 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
						提示：当前尚未登录 567 API 账户，请先在登录界面完成登录或注册，登录后即可为当前账户充值额度。
					</div>
				)}

				{/* ---------------- 1. 支付成功状态 ---------------- */}
				{payView === "success" && (
					<div className="my-8 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-200">
						<CheckCircle2 className="h-16 w-16 text-primary" />
						<h4 className="mt-3 font-bold text-base text-foreground">{t("topupUi.success")}</h4>
						<p className="mt-1 text-xs text-muted-foreground">{t("topupUi.credited")}</p>
						<div className="mt-4 rounded-xl bg-primary/10 px-4 py-2 text-xs font-semibold text-foreground">
							{t("topupUi.latestBalance")}: $
							{status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
						</div>
					</div>
				)}

				{/* ---------------- 2. 原生付款码视图 (方案 1) ---------------- */}
				{payView === "qrcode" && qrDataUrl && (
					<div className="my-3 flex flex-col items-center text-center animate-in fade-in duration-150">
						<div className="flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1 text-xs font-medium text-foreground">
							{paymentMethod === "alipay" ? (
								<>
									<span className="font-bold text-primary">{t("topupUi.alipay")}</span>
									<span>{t("topupUi.alipayScan")}</span>
								</>
							) : (
								<>
									<span className="font-bold text-primary">{t("topupUi.wechat")}</span>
									<span>{t("topupUi.wechatScan")}</span>
								</>
							)}
						</div>

						{/* 原生二维码呈现卡片 */}
						<div className="mt-3 relative rounded-2xl border border-border/80 bg-white p-3 shadow-md">
							<img src={qrDataUrl} alt={t("topupUi.qrAlt")} className="h-56 w-56 rounded-xl object-contain" />
						</div>

						{/* 金额与状态 */}
						<div className="mt-3">
							<div className="font-bold text-lg text-foreground">¥{paidAmount}.00</div>
							<div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
								<Loader2 className="h-3 w-3 animate-spin text-primary" />
								<span>{t("topupUi.waiting")}</span>
							</div>
						</div>
						{paymentPollExpired && (
							<p role="status" className="mt-2 text-xs text-muted-foreground">
								{t("topupStatus.pollingPaused")}
							</p>
						)}

						{/* 底部操作条 */}
						<div className="mt-4 flex w-full gap-2 border-t pt-3">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setPayView("input")}
								className="h-8 flex-1 gap-1 text-xs"
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								<span>{t("topupUi.back")}</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={refreshingQuota}
								onClick={handleManualRefresh}
								className="h-8 gap-1 text-xs px-3"
								title={t("topupUi.refresh")}
							>
								<RefreshCw className={`h-3.5 w-3.5 ${refreshingQuota ? "animate-spin text-primary" : ""}`} />
								<span>{t("topupUi.paid")}</span>
							</Button>
						</div>

						{/* 方案 3 内置收银台切换入口 */}
						{fallbackUrl && (
							<button
								type="button"
								onClick={() => setPayView("iframe")}
								className="mt-2 text-[11px] text-muted-foreground hover:text-primary transition-colors"
							>
								{t("topupUi.switchCheckout")}
							</button>
						)}
					</div>
				)}

				{/* ---------------- 3. 内置收银台兜底视图 (方案 3) ---------------- */}
				{payView === "iframe" && fallbackUrl && (
					<div className="my-2 flex flex-col animate-in fade-in duration-150">
						<div className="mb-2 flex items-center justify-between text-xs">
							<span className="font-medium text-muted-foreground">{t("topupUi.checkout")}</span>
							<button
								type="button"
								onClick={() => openExternal(fallbackUrl)}
								className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
							>
								<span>{t("topupUi.external")}</span>
								<ExternalLink className="h-3 w-3" />
							</button>
						</div>
						<div className="h-80 w-full overflow-hidden rounded-xl border border-border/80 bg-white">
							<iframe src={fallbackUrl} title={t("topupUi.checkoutTitle")} className="h-full w-full border-0" />
						</div>
						{paymentPollExpired && (
							<p role="status" className="mt-2 text-xs text-muted-foreground">
								{t("topupStatus.pollingPausedManual")}
							</p>
						)}
						<div className="mt-3 flex items-center justify-between border-t pt-3">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setPayView("input")}
								className="h-8 gap-1 text-xs"
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								<span>{t("topupUi.change")}</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={refreshingQuota}
								onClick={handleManualRefresh}
								className="h-8 gap-1 text-xs"
							>
								<RefreshCw className={`h-3.5 w-3.5 ${refreshingQuota ? "animate-spin text-primary" : ""}`} />
								<span>{t("topupUi.paidRefresh")}</span>
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
								<span>{t("topupUi.online")}</span>
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
								<span>{t("topupUi.redeem")}</span>
							</button>
						</div>

						{/* 在线扫码充值 Tab */}
						{activeTab === "online" && onlineUnavailable ? (
							<div role="alert" className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
								<span className="icon-[solar--wallet-linear] h-6 w-6 text-muted-foreground" />
								<h3 className="text-[14px] font-semibold">{t("topupStatus.unavailableTitle")}</h3>
								<p className="text-[12px] leading-relaxed text-muted-foreground">
									{t("topupStatus.unavailableDescription")}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setActiveTab("card");
											setErrorMsg(null);
										}}
									>
										{t("topupStatus.useCard")}
									</Button>
									<Button variant="ghost" size="sm" onClick={() => setOnlineUnavailable(false)}>
										{t("topupStatus.retryChannel")}
									</Button>
								</div>
							</div>
						) : activeTab === "online" ? (
							<form onSubmit={handlePaySubmit} className="space-y-4">
								{/* 支付方式 */}
								<div>
									<label className="mb-1.5 block font-medium text-xs text-foreground">
										{t("topupUi.channel")}
									</label>
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
											<span className="font-bold text-primary">{t("topupUi.alipay")}</span>
											<span>{t("topupUi.alipay")}</span>
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
											<span className="font-bold text-primary">{t("topupUi.wechat")}</span>
											<span>{t("topupUi.wechat")}</span>
											{paymentMethod === "wxpay" && <Check className="h-3.5 w-3.5" />}
										</button>
									</div>
								</div>

								{/* 充值金额快速点选 */}
								<div>
									<div className="mb-1.5 flex items-center justify-between text-xs">
										<label className="font-medium text-foreground">{t("topupUi.amount")}</label>
										<span className="text-[11px] text-muted-foreground">{t("topupUi.rate")}</span>
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
													<span className="text-[10px] text-muted-foreground">
														{t("topupUi.creditedAmount", { amount: amt })}
													</span>
												</button>
											);
										})}
										{/* 自定义金额 */}
										<div className="relative">
											<Input
												type="number"
												min="1"
												step="1"
												placeholder={t("topupUi.custom")}
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
												<span>{t("topupUi.generating")}</span>
											</>
										) : (
											<>
												<Scan className="h-4 w-4" />
												<span>{t("topupUi.pay", { amount: customAmount || amount })}</span>
											</>
										)}
									</Button>
								</div>
							</form>
						) : (
							/* 卡密兑换 Tab */
							<form onSubmit={handleCardSubmit} className="space-y-4">
								<div>
									<label className="mb-1.5 block font-medium text-xs text-foreground">
										{t("topupUi.keyLabel")}
									</label>
									<Input
										type="text"
										placeholder={t("topupUi.keyPlaceholder")}
										value={cardKey}
										onChange={(e) => setCardKey(e.target.value)}
										disabled={loading}
										autoFocus
										required
										className="h-10 font-mono text-xs"
									/>
									<p className="mt-1.5 text-[11px] text-muted-foreground">{t("topupUi.keyHint")}</p>
								</div>

								<Button
									type="submit"
									disabled={loading || !cardKey.trim() || !status.isLoggedIn}
									className="h-10 w-full gap-2 font-semibold"
								>
									{loading ? (
										<>
											<Loader2 className="h-4 w-4 animate-spin" />
											<span>{t("topupUi.redeeming")}</span>
										</>
									) : (
										<>
											<Sparkles className="h-4 w-4" />
											<span>{t("topupUi.redeemAction")}</span>
										</>
									)}
								</Button>
							</form>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
