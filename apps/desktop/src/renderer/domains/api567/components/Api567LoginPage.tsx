import { Api567TopupModal } from "./Api567TopupModal";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { ArrowRight, Key, Lock, Mail, ShieldCheck, Sparkles, User, UserPlus } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi567 } from "../hooks/useApi567";
import { ServiceRouteSettings } from "./ServiceRouteSettings";

export function Api567LoginPage(): JSX.Element {
	const { t } = useTranslation("settings");
	const { loginWithAccessToken, loginWithPassword, sendVerificationCode, register, setTopupModalOpen, loading } =
		useApi567();

	const [activeTab, setActiveTab] = useState<"token" | "account" | "register">("token");
	const [token, setToken] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");

	// 注册字段
	const [regUsername, setRegUsername] = useState("");
	const [regEmail, setRegEmail] = useState("");
	const [regCode, setRegCode] = useState("");
	const [regPassword, setRegPassword] = useState("");
	const [regConfirmPassword, setRegConfirmPassword] = useState("");
	const [regAffCode, setRegAffCode] = useState("");
	const [sendingCode, setSendingCode] = useState(false);
	const [cooldown, setCooldown] = useState(0);

	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// 验证码倒计时
	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	const handleTokenSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		const clean = token.trim();
		if (!clean) {
			setErrorMsg(t("api567Login.tokenRequired"));
			return;
		}
		const res = await loginWithAccessToken(clean);
		if (!res.success) {
			setErrorMsg(res.message || t("api567Login.tokenFailed"));
		}
	};

	const handleAccountSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		if (!username.trim() || !password.trim()) {
			setErrorMsg(t("api567Login.credentialsRequired"));
			return;
		}
		const res = await loginWithPassword(username.trim(), password.trim());
		if (!res.success) {
			setErrorMsg(res.message || t("api567Login.loginFailed"));
		}
	};

	const handleSendCode = async () => {
		if (cooldown > 0 || sendingCode) return;
		if (!regEmail.trim()) {
			setErrorMsg(t("api567Login.emailRequired"));
			return;
		}
		setErrorMsg(null);
		setSendingCode(true);
		try {
			const res = await sendVerificationCode(regEmail.trim());
			if (res.success) {
				setCooldown(60);
			} else {
				setErrorMsg(res.message || t("api567Login.codeFailed"));
			}
		} finally {
			setSendingCode(false);
		}
	};

	const handleRegisterSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		if (!regUsername.trim() || !regEmail.trim() || !regCode.trim() || !regPassword.trim()) {
			setErrorMsg(t("api567Login.registrationRequired"));
			return;
		}
		if (regPassword.length < 8) {
			setErrorMsg(t("api567Login.passwordLength"));
			return;
		}
		if (regPassword !== regConfirmPassword) {
			setErrorMsg(t("api567Login.passwordMismatch"));
			return;
		}
		const res = await register({
			username: regUsername.trim(),
			password: regPassword.trim(),
			email: regEmail.trim(),
			verification_code: regCode.trim(),
			aff_code: regAffCode.trim() || undefined,
		});
		if (!res.success) {
			setErrorMsg(res.message || t("api567Login.registrationFailed"));
		}
	};

	return (
		<div className="relative flex min-h-screen w-full select-none items-center justify-center overflow-hidden bg-background p-4 text-foreground">
			{/* 背景装饰光晕 */}
			<div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />
			<div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-primary/15 blur-[120px]" />

			<div className="relative z-10 w-full max-w-md rounded-2xl border border-border/70 bg-card/85 p-8 shadow-lg backdrop-blur-xl transition-colors">
				{/* 品牌头部 */}
				<div className="mb-6 flex flex-col items-center text-center">
					<BrandIcon className="mb-3 h-14 w-14" />
					<h1 className="font-bold text-2xl tracking-tight text-foreground">567 Agent</h1>
					<p className="mt-1 text-muted-foreground text-xs">{t("api567Login.subtitle")}</p>

					<div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-medium text-[11px] text-primary">
						<ShieldCheck className="h-3.5 w-3.5" />
						<span>{t("api567Login.security")}</span>
					</div>
				</div>

				<ServiceRouteSettings />
				{/* 切换选项卡 */}
				<div className="mb-5 flex rounded-xl bg-muted/60 p-1 text-xs">
					<button
						type="button"
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors ${
							activeTab === "token"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
						onClick={() => {
							setActiveTab("token");
							setErrorMsg(null);
						}}
					>
						<Key className="h-3.5 w-3.5" />
						<span>{t("api567Login.tokenTab")}</span>
					</button>
					<button
						type="button"
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors ${
							activeTab === "account"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
						onClick={() => {
							setActiveTab("account");
							setErrorMsg(null);
						}}
					>
						<User className="h-3.5 w-3.5" />
						<span>{t("api567Login.accountTab")}</span>
					</button>
					<button
						type="button"
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors ${
							activeTab === "register"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
						onClick={() => {
							setActiveTab("register");
							setErrorMsg(null);
						}}
					>
						<UserPlus className="h-3.5 w-3.5" />
						<span>{t("api567Login.registerTab")}</span>
					</button>
				</div>

				{/* 错误提示条 */}
				{errorMsg && (
					<div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs leading-relaxed animate-in fade-in duration-200">
						{errorMsg}
					</div>
				)}

				{/* 1. 账户令牌登录表单 */}
				{activeTab === "token" && (
					<form onSubmit={handleTokenSubmit} className="flex flex-col gap-4">
						<div>
							<div className="mb-1.5 text-xs">
								<label className="font-medium text-foreground">{t("api567Login.tokenLabel")}</label>
							</div>
							<Input
								type="password"
								placeholder={t("api567Login.tokenPlaceholder")}
								value={token}
								onChange={(e) => setToken(e.target.value)}
								disabled={loading}
								autoFocus
								required
								className="h-10"
							/>
							<p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
								{t("api567Login.tokenHint")}
							</p>
						</div>

						<Button type="submit" disabled={loading} className="mt-1 h-10 w-full gap-2 font-semibold">
							{loading ? (
								<>
									<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									<span>{t("api567Login.verifying")}</span>
								</>
							) : (
								<>
									<span>{t("api567Login.tokenSubmit")}</span>
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				)}

				{/* 2. 账号密码登录表单 */}
				{activeTab === "account" && (
					<form onSubmit={handleAccountSubmit} className="flex flex-col gap-3.5">
						<div>
							<label className="mb-1.5 block font-medium text-foreground text-xs">
								{t("api567Login.usernameLabel")}
							</label>
							<Input
								type="text"
								placeholder={t("api567Login.usernamePlaceholder")}
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								disabled={loading}
								autoFocus
								required
								className="h-10"
							/>
						</div>

						<div>
							<div className="mb-1.5 text-xs">
								<label className="font-medium text-foreground">{t("api567Login.passwordLabel")}</label>
							</div>
							<Input
								type="password"
								placeholder={t("api567Login.passwordPlaceholder")}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={loading}
								required
								className="h-10"
							/>
						</div>

						<Button type="submit" disabled={loading} className="mt-2 h-10 w-full gap-2 font-semibold">
							{loading ? (
								<>
									<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									<span>{t("api567Login.loggingIn")}</span>
								</>
							) : (
								<>
									<span>{t("api567Login.loginSubmit")}</span>
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				)}

				{/* 3. 注册新账号表单 */}
				{activeTab === "register" && (
					<form onSubmit={handleRegisterSubmit} className="flex flex-col gap-3">
						<div>
							<label className="mb-1 block font-medium text-foreground text-xs">
								{t("api567Login.newUsername")}
							</label>
							<Input
								type="text"
								placeholder={t("api567Login.newUsernamePlaceholder")}
								value={regUsername}
								onChange={(e) => setRegUsername(e.target.value)}
								disabled={loading}
								required
								className="h-9 text-xs"
							/>
						</div>

						<div>
							<label className="mb-1 block font-medium text-foreground text-xs">{t("api567Login.email")}</label>
							<div className="flex gap-2">
								<Input
									type="email"
									placeholder={t("api567Login.emailPlaceholder")}
									value={regEmail}
									onChange={(e) => setRegEmail(e.target.value)}
									disabled={loading || cooldown > 0}
									required
									className="h-9 flex-1 text-xs"
								/>
								<Button
									type="button"
									variant="outline"
									disabled={loading || cooldown > 0 || sendingCode}
									onClick={handleSendCode}
									className="h-9 shrink-0 px-3 text-xs"
								>
									{sendingCode
										? t("api567Login.sendingCode")
										: cooldown > 0
											? `${cooldown}s`
											: t("api567Login.getCode")}
								</Button>
							</div>
						</div>

						<div>
							<label className="mb-1 block font-medium text-foreground text-xs">
								{t("api567Login.codeLabel")}
							</label>
							<Input
								type="text"
								placeholder={t("api567Login.codePlaceholder")}
								value={regCode}
								onChange={(e) => setRegCode(e.target.value)}
								disabled={loading}
								required
								className="h-9 text-xs font-mono"
							/>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<div>
								<label className="mb-1 block font-medium text-foreground text-xs">
									{t("api567Login.newPassword")}
								</label>
								<Input
									type="password"
									placeholder={t("api567Login.newPasswordPlaceholder")}
									value={regPassword}
									onChange={(e) => setRegPassword(e.target.value)}
									disabled={loading}
									required
									className="h-9 text-xs"
								/>
							</div>
							<div>
								<label className="mb-1 block font-medium text-foreground text-xs">
									{t("api567Login.confirmPassword")}
								</label>
								<Input
									type="password"
									placeholder={t("api567Login.confirmPasswordPlaceholder")}
									value={regConfirmPassword}
									onChange={(e) => setRegConfirmPassword(e.target.value)}
									disabled={loading}
									required
									className="h-9 text-xs"
								/>
							</div>
						</div>

						<div>
							<label className="mb-1 block font-medium text-foreground text-xs">
								{t("api567Login.invitation")}
							</label>
							<Input
								type="text"
								placeholder={t("api567Login.invitationPlaceholder")}
								value={regAffCode}
								onChange={(e) => setRegAffCode(e.target.value)}
								disabled={loading}
								className="h-9 text-xs font-mono"
							/>
						</div>

						<Button type="submit" disabled={loading} className="mt-2 h-10 w-full gap-2 font-semibold">
							{loading ? (
								<>
									<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									<span>{t("api567Login.registering")}</span>
								</>
							) : (
								<>
									<span>{t("api567Login.registerSubmit")}</span>
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				)}

				{/* 底部导航与快捷链接 */}
				<div className="mt-5 border-border/50 border-t pt-4 text-center text-xs">
					<div className="flex items-center justify-center gap-3 text-muted-foreground">
						{activeTab !== "register" ? (
							<button
								type="button"
								onClick={() => {
									setActiveTab("register");
									setErrorMsg(null);
								}}
								className="transition-colors hover:text-primary font-medium text-primary"
							>
								{t("api567Login.newAccount")}
							</button>
						) : (
							<button
								type="button"
								onClick={() => {
									setActiveTab("token");
									setErrorMsg(null);
								}}
								className="transition-colors hover:text-primary font-medium text-primary"
							>
								{t("api567Login.back")}
							</button>
						)}
						<span>·</span>
						<button
							type="button"
							onClick={() => setTopupModalOpen(true)}
							className="transition-colors hover:text-primary"
						>
							{t("api567Login.topup")}
						</button>
					</div>
				</div>
			</div>
			<Api567TopupModal />
		</div>
	);
}
import { BrandIcon } from "@shared/components/BrandIcon";
