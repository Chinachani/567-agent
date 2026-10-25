import { useTranslation } from "react-i18next";
import type React from "react";
import { useApi567 } from "../hooks/useApi567";
import { Api567LoginPage } from "./Api567LoginPage";
import { Api567TopupModal } from "./Api567TopupModal";

export function Api567AuthGate({ children }: { children: React.ReactNode }): JSX.Element {
	const { t } = useTranslation("settings");
	const { status, initialCheckDone } = useApi567();

	// 首屏异步检查状态阶段，显示优雅的品牌加载占位
	if (!initialCheckDone) {
		return (
			<div className="flex min-h-screen w-full select-none items-center justify-center bg-background text-foreground">
				<div className="flex flex-col items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-lg">
						567
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						<span>{t("api567Login.checking")}</span>
					</div>
				</div>
			</div>
		);
	}

	// 若未登录，开屏强制展示登录界面，严格阻断进入主应用
	if (!status.isLoggedIn) {
		return <Api567LoginPage />;
	}

	// 登录成功后，正常渲染主工作区
	return (
		<>
			{children}
			<Api567TopupModal />
		</>
	);
}
