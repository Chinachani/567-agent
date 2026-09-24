import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import {
	Check,
	CreditCard,
	ExternalLink,
	Key,
	Loader2,
	QrCode,
	RefreshCw,
	Sparkles,
	Wallet,
	X,
} from "lucide-react";
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
	const [paying, setPaying] = useState(false);
	const [payingNotice, setPayingNotice] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// 打开在线支付后周期性轮询余额更新
	useEffect(() => {
		if (!topupModalOpen || !payingNotice) return;
		const timer = setInterval(() => {
			void refreshQuota(true);
		}, 3000);
		return () => clearInterval(timer);
	}, [topupModalOpen, payingNotice, refreshQuota]);

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
		try {
			const res = await createPayOrder(finalAmount, paymentMethod);
			if (res.success && res.payUrl) {
				setPayingNotice(true);
				if (window.vetta?.shell?.openExternal) {
					void window.vetta.shell.openExternal(res.payUrl);
				} else {
					window.open(res.payUrl, "_blank");
				}
			} else {
				setErrorMsg(res.message || "未能创建支付订单，请稍后重试");
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
			setTimeout(() => {
				setTopupModalOpen(false);
			}, 1000);
		} else {
			setErrorMsg(res.message || "卡密兑换失败，请确认卡密有效后重试");
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 shadow-2xl">
				{/* 顶栏关闭 */}
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
						onClick={() => {
							setTopupModalOpen(false);
							setPayingNotice(false);
						}}
						className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>

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
						<span>在线支付充值</span>
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

				{/* 错误提示条 */}
				{errorMsg && (
					<div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-destructive text-xs">
						{errorMsg}
					</div>
				)}

				{/* 在线充值 Tab */}
				{activeTab === "online" ? (
					<form onSubmit={handlePaySubmit} className="space-y-4">
						{/* 支付方式 */}
						<div>
							<label className="mb-1.5 block font-medium text-xs text-foreground">支付方式</label>
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

						{/* 支付中等待提示 */}
						{payingNotice && (
							<div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
								<div className="flex items-center gap-2 text-primary font-medium">
									<Loader2 className="h-4 w-4 animate-spin" />
									<span>已前往收银台，等待支付完成...</span>
								</div>
								<p className="mt-1 text-[11px] text-muted-foreground">
									付款成功后，客户端会自动侦测到账并同步余额。若已完成，亦可点击下方刷新。
								</p>
							</div>
						)}

						<div className="flex gap-2 pt-1">
							<Button
								type="submit"
								disabled={paying}
								className="h-10 flex-1 gap-2 font-semibold"
							>
								{paying ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										<span>正在创建订单...</span>
									</>
								) : (
									<>
										<span>前往支付 ¥{customAmount || amount}</span>
										<ExternalLink className="h-3.5 w-3.5" />
									</>
								)}
							</Button>
							{payingNotice && (
								<Button
									type="button"
									variant="outline"
									onClick={() => void refreshQuota(true)}
									className="h-10 px-3"
									title="手动刷新余额"
								>
									<RefreshCw className="h-4 w-4" />
								</Button>
							)}
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
							disabled={loading || !cardKey.trim()}
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
			</div>
		</div>
	);
}
