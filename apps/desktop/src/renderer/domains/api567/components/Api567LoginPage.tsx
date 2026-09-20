import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { ArrowRight, ExternalLink, Key, Lock, ShieldCheck, Sparkles, User } from "lucide-react";
import React, { useState } from "react";
import { useApi567 } from "../hooks/useApi567";

export function Api567LoginPage(): JSX.Element {
	const { loginWithAccessToken, loginWithPassword, loading } = useApi567();
	const [activeTab, setActiveTab] = useState<"token" | "account">("token");
	const [token, setToken] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const handleTokenSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		const clean = token.trim();
		if (!clean) {
			setErrorMsg("请输入您的 567 API 账户系统访问令牌");
			return;
		}
		const res = await loginWithAccessToken(clean);
		if (!res.success) {
			setErrorMsg(res.message || "令牌验证失败，请确认令牌有效后重试");
		}
	};

	const handleAccountSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrorMsg(null);
		if (!username.trim() || !password.trim()) {
			setErrorMsg("用户名和密码不能为空");
			return;
		}
		const res = await loginWithPassword(username.trim(), password.trim());
		if (!res.success) {
			setErrorMsg(res.message || "登录失败，请检查用户名或密码");
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
		<div className="relative flex min-h-screen w-full select-none items-center justify-center overflow-hidden bg-background p-4 text-foreground">
			{/* 背景装饰光晕 */}
			<div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />
			<div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-primary/15 blur-[120px]" />

			<div className="relative z-10 w-full max-w-md rounded-2xl border border-border/70 bg-card/85 p-8 shadow-2xl backdrop-blur-xl transition-all">
				{/* 品牌头部 */}
				<div className="mb-6 flex flex-col items-center text-center">
					<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-primary/70 text-primary-foreground shadow-lg shadow-primary/25">
						<span className="font-black text-xl tracking-tight">567</span>
					</div>
					<h1 className="font-bold text-2xl tracking-tight text-foreground">567 Agent</h1>
					<p className="mt-1 text-muted-foreground text-xs">
						专为 567 API 打造的本地 AI 智能工作台
					</p>

					<div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-medium text-[11px] text-primary">
						<ShieldCheck className="h-3.5 w-3.5" />
						<span>开屏安全验证 · 登录后进入工作台</span>
					</div>
				</div>

				{/* 切换选项卡 */}
				<div className="mb-5 flex rounded-xl bg-muted/60 p-1 text-xs">
					<button
						type="button"
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all ${
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
						<span>账户令牌登录 (推荐)</span>
					</button>
					<button
						type="button"
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all ${
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
						<span>账号密码登录</span>
					</button>
				</div>

				{/* 错误提示条 */}
				{errorMsg && (
					<div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs leading-relaxed animate-in fade-in duration-200">
						{errorMsg}
					</div>
				)}

				{/* 账户令牌登录表单 */}
				{activeTab === "token" ? (
					<form onSubmit={handleTokenSubmit} className="flex flex-col gap-4">
						<div>
							<div className="mb-1.5 flex items-center justify-between text-xs">
								<label className="font-medium text-foreground">系统访问令牌 (Access Token)</label>
								<button
									type="button"
									onClick={() => openExternal("https://api.567.wiki/console/personal")}
									className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
								>
									<span>获取访问令牌</span>
									<ExternalLink className="h-3 w-3" />
								</button>
							</div>
							<Input
								type="password"
								placeholder="请输入 567 API 系统访问令牌"
								value={token}
								onChange={(e) => setToken(e.target.value)}
								disabled={loading}
								autoFocus
								required
								className="h-10"
							/>
							<p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
								登录 567 API 网页端后，在「个人设置 → 安全设置 → 系统访问令牌」中生成或复制。客户端将自动创建并管理专属密钥与模型配置。
							</p>
						</div>

						<Button type="submit" disabled={loading} className="mt-1 h-10 w-full gap-2 font-semibold">
							{loading ? (
								<>
									<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									<span>正在验证账户并载入模型...</span>
								</>
							) : (
								<>
									<span>一键验证并启动 567 Agent</span>
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				) : (
					/* 账号密码登录表单 */
					<form onSubmit={handleAccountSubmit} className="flex flex-col gap-3.5">
						<div>
							<label className="mb-1.5 block font-medium text-foreground text-xs">用户名 / 邮箱</label>
							<div className="relative">
								<Input
									type="text"
									placeholder="请输入 567 API 用户名"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									disabled={loading}
									autoFocus
									required
									className="h-10"
								/>
							</div>
						</div>

						<div>
							<div className="mb-1.5 flex items-center justify-between text-xs">
								<label className="font-medium text-foreground">密码</label>
								<button
									type="button"
									onClick={() => openExternal("https://api.567.wiki")}
									className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
								>
									忘记密码？
								</button>
							</div>
							<div className="relative">
								<Input
									type="password"
									placeholder="请输入密码"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									disabled={loading}
									required
									className="h-10"
								/>
							</div>
						</div>

						<Button type="submit" disabled={loading} className="mt-2 h-10 w-full gap-2 font-semibold">
							{loading ? (
								<>
									<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									<span>正在登录并载入模型...</span>
								</>
							) : (
								<>
									<span>登录并启动 567 Agent</span>
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				)}

				{/* 底部导航与快捷链接 */}
				<div className="mt-6 border-border/50 border-t pt-4 text-center text-xs">
					<div className="flex items-center justify-center gap-3 text-muted-foreground">
						<button
							type="button"
							onClick={() => openExternal("https://api.567.wiki")}
							className="transition-colors hover:text-primary"
						>
							注册账户
						</button>
						<span>·</span>
						<button
							type="button"
							onClick={() => openExternal("https://api.567.wiki/console/topup")}
							className="transition-colors hover:text-primary"
						>
							额度充值
						</button>
						<span>·</span>
						<button
							type="button"
							onClick={() => openExternal("https://api.567.wiki/docs")}
							className="transition-colors hover:text-primary"
						>
							接口文档
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
