import { Api567AccountDialog, useApi567 } from "@domains/api567";
import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { UserAvatar } from "@shared/components/UserAvatar";
import { cn } from "@shared/lib/utils";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import { useSetAtom } from "jotai";
import { forwardRef, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCenterDialog } from "./message-center/MessageCenterDialog";
import { useMessageCenterModel } from "./message-center/useMessageCenterModel";
import type { SettingsMenuTriggerProps } from "./settings-menu/SettingsMenuTrigger";
import {
	useRefreshBillingOnOpen,
	useSettingsMenuModel,
	useSyncUpdateOnOpen,
} from "./settings-menu/useSettingsMenuModel";

type Panel = "account" | null;

const SettingsMenuItem = forwardRef<HTMLButtonElement, SettingsMenuTriggerProps>(function SettingsMenuItem(
	{ model: _model, className, ...props },
	ref,
) {
	const { t } = useTranslation("settings");
	return (
		<Button
			ref={ref}
			variant="ghost"
			className={cn("h-auto w-full justify-start gap-2 text-[13px] font-normal text-foreground", className)}
			{...props}
		>
			<span aria-hidden="true" className="icon-[solar--settings-linear] h-4 w-4" />
			{t("sidebarAccount.settings")}
		</Button>
	);
});

export function SidebarAccountMenu({ className }: { className?: string }): JSX.Element {
	const { t } = useTranslation("settings");
	const { t: message } = useTranslation("message");
	const api = useApi567();
	const { status, logout, setTopupModalOpen, setModalOpen } = api;
	const [open, setOpen] = useState(false);
	const [panel, setPanel] = useState<Panel>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	// Wait for the previous focus scope to close before opening the next one.
	const pendingAction = useRef<(() => void) | null>(null);
	const unreadId = useId();
	const messages = useMessageCenterModel();
	const navigate = useNavigate();
	const openSettings = () => void navigate({ to: "/settings/$tab", params: { tab: "general" } });
	const settings = useSettingsMenuModel(false, (value) => {
		if (value) openSettings();
	});
	const refreshBilling = useRefreshBillingOnOpen();
	const syncUpdate = useSyncUpdateOnOpen();
	const setConfirm = useSetAtom(confirmDialogAtom);
	const ThemedSettingsMenuItem = useThemeComponent("sidebar.settingsTrigger", SettingsMenuItem);
	const name = status.isLoggedIn ? status.username || t("api567Account.fallbackName") : t("sidebarAccount.guest");
	const quota = `$${(status.quotaUsd ?? 0).toFixed(2)}`;
	const balance = status.isLoggedIn ? t("sidebarAccount.balance", { amount: quota }) : t("sidebarAccount.notSignedIn");

	const closeFocus = (event: Event) => {
		event.preventDefault();
		const action = pendingAction.current;
		pendingAction.current = null;
		trigger.current?.focus();
		action?.();
	};
	const select = (action: () => void) => {
		pendingAction.current = action;
		setOpen(false);
	};
	const confirmLogout = () =>
		setConfirm({
			title: t("api567Account.logoutTitle"),
			message: t("api567Account.logoutMessage"),
			variant: "danger",
			confirmLabel: t("api567Account.logout"),
			onConfirm: () => {
				void logout();
			},
		});

	return (
		<>
			<DropdownMenu
				open={open}
				onOpenChange={(value) => {
					setOpen(value);
					refreshBilling(value, settings.user !== null);
					syncUpdate(value);
				}}
			>
				<DropdownMenuTrigger asChild>
					<Button
						ref={trigger}
						variant="ghost"
						className={cn(
							"h-auto w-full min-w-0 justify-start gap-2.5 rounded-lg px-2 py-2 text-left font-normal data-[state=open]:bg-accent/60",
							className,
						)}
						aria-label={t("api567Account.open", { name })}
						aria-describedby={messages.totalUnread > 0 ? unreadId : undefined}
					>
						{status.isLoggedIn ? (
							<UserAvatar
								username={status.loginUsername || status.username}
								className="h-7 w-7 shrink-0 bg-accent text-foreground"
								textClassName="text-[12px]"
							/>
						) : (
							<span
								aria-hidden="true"
								className="icon-[solar--user-circle-linear] h-8 w-8 shrink-0 text-muted-foreground"
							/>
						)}
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="truncate text-[13px] font-medium leading-4 text-foreground" title={name}>
								{name}
							</span>
							<span
								className="truncate font-mono text-[11px] leading-4 text-muted-foreground tabular-nums"
								title={balance}
							>
								{balance}
							</span>
						</span>
						<span className="relative shrink-0">
							<span
								aria-hidden="true"
								className="icon-[solar--alt-arrow-down-linear] block h-4 w-4 text-muted-foreground"
							/>
							{messages.totalUnread > 0 && (
								<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
							)}
						</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="top"
					align="start"
					onCloseAutoFocus={closeFocus}
					className="w-64 max-w-[calc(100vw-1rem)]"
				>
					<DropdownMenuLabel className="space-y-1 px-3 pb-2 text-[12px] text-foreground">
						<span className="block truncate font-medium">{name}</span>
						<span className="block truncate font-normal text-muted-foreground">{balance}</span>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{status.isLoggedIn && (
						<>
							<DropdownMenuItem onSelect={() => select(() => setPanel("account"))}>
								<span aria-hidden="true" className="icon-[solar--user-circle-linear] h-4 w-4" />
								{t("sidebarAccount.details")}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => select(() => setTopupModalOpen(true))}>
								<span aria-hidden="true" className="icon-[solar--wallet-linear] h-4 w-4" />
								{t("api567Account.topup")}
							</DropdownMenuItem>
						</>
					)}
					{!status.isLoggedIn && (
						<DropdownMenuItem onSelect={() => select(() => setModalOpen(true))}>
							<span aria-hidden="true" className="icon-[solar--login-2-linear] h-4 w-4" />
							{t("sidebarAccount.signIn")}
						</DropdownMenuItem>
					)}

					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => select(() => messages.setOpen(true))}>
						<span aria-hidden="true" className="icon-[solar--bell-linear] h-4 w-4" />
						{message("triggerTitle")}
						{messages.totalUnread > 0 && (
							<span className="ml-auto rounded bg-accent px-1.5 text-[11px] tabular-nums">
								{messages.totalUnread}
							</span>
						)}
					</DropdownMenuItem>

					<DropdownMenuItem
						onSelect={() =>
							select(() => {
								void navigate({ to: "/settings/$tab", params: { tab: "im" } });
							})
						}
					>
						<span aria-hidden="true" className="icon-[solar--chat-round-line-linear] h-4 w-4" />
						Claw
						<span className="ml-auto text-[11px] text-muted-foreground">
							{t(settings.clawOnline ? "sidebarAccount.connected" : "sidebarAccount.disconnected")}
						</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<div className="flex items-center justify-between gap-3 px-3 py-2">
						<span className="text-[12px] text-muted-foreground">{t("theme.title")}</span>
						<div role="group" aria-label={t("theme.title")} className="flex gap-1 rounded-md bg-accent/50 p-0.5">
							{settings.themeOptions.map((option) => (
								<DropdownMenuItem
									key={option.value}
									asChild
									role="menuitemradio"
									aria-checked={settings.mode === option.value}
									onSelect={(event) => event.preventDefault()}
								>
									<Button
										variant={settings.mode === option.value ? "secondary" : "ghost"}
										size="icon-xs"
										className="p-1"
										aria-label={option.label}
										title={option.label}
										onClick={(event) => settings.actions.setMode(option.value, event)}
									>
										<span aria-hidden="true" className={cn(option.icon, "h-4 w-4")} />
									</Button>
								</DropdownMenuItem>
							))}
						</div>
					</div>
					<DropdownMenuItem asChild onSelect={() => select(openSettings)}>
						<ThemedSettingsMenuItem model={settings} />
					</DropdownMenuItem>
					{status.isLoggedIn && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive focus:text-destructive"
								onSelect={() => select(confirmLogout)}
							>
								<span aria-hidden="true" className="icon-[solar--logout-2-linear] h-4 w-4" />
								{t("api567Account.logout")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{messages.totalUnread > 0 && (
				<span className="sr-only" id={unreadId}>
					{t("sidebarAccount.unread", { count: messages.totalUnread })}
				</span>
			)}
			<Api567AccountDialog
				api={api}
				open={panel === "account"}
				onOpenChange={(value) => setPanel(value ? "account" : null)}
				onCloseAutoFocus={closeFocus}
				onTopup={() => {
					pendingAction.current = () => setTopupModalOpen(true);
					setPanel(null);
				}}
			/>
			<MessageCenterDialog
				activeTab={messages.activeTab}
				chatUnread={messages.chatUnread}
				notifUnread={messages.notifUnread}
				open={messages.open}
				pendingCount={messages.pendingCount}
				onClose={messages.close}
				onOpenChange={messages.setOpen}
				onSelectTab={messages.setActiveTab}
				onCloseAutoFocus={closeFocus}
			/>
		</>
	);
}
