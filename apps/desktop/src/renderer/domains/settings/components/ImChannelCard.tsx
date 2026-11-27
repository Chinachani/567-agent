import { useTranslation } from "react-i18next";
import type { ImTransportStatus } from "@preload/api";
import {
	ImChannelCardView,
	type ImChannelCardIcon,
	type ImChannelCardViewProps,
	type ImStatusBadgeStatus,
} from "@vetta-org/theme-ui/settings";

const STATUS_LABEL: Record<ImTransportStatus, string> = {
	offline: "imbStatusOffline",
	connecting: "imbStatusConnecting",
	online: "imbStatusOnline",
	error: "imbStatusError",
	awaiting_bind: "imbStatusAwaitingBind",
};

export function ImChannelCard({
	name,
	subtitle,
	icon,
	configured,
	isActive = false,
	bridgeEnabled = false,
	channelStatus,
	statusPending = false,
	transportStatus = "offline",
	configureLabel,
	onConfigure,
	onActivate,
}: {
	name: string;
	subtitle: string;
	icon: ImChannelCardIcon;
	configured: boolean;
	isActive?: boolean;
	bridgeEnabled?: boolean;
	channelStatus?: ImTransportStatus;
	statusPending?: boolean;
	transportStatus?: ImTransportStatus;
	configureLabel: string;
	onConfigure: () => void;
	onActivate?: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");

	let displayMode: ImChannelCardViewProps["displayMode"];
	let effectiveStatus: ImTransportStatus = "offline";

	if (channelStatus !== undefined) {
		if (channelStatus === "offline" && !configured) {
			displayMode = "unconfigured";
		} else if (channelStatus === "offline" && !bridgeEnabled) {
			displayMode = "configured";
		} else {
			displayMode = "status";
			effectiveStatus = channelStatus;
		}
	} else if (isActive) {
		displayMode = "status";
		effectiveStatus = transportStatus;
	} else if (configured) {
		displayMode = statusPending ? "pending" : "configured";
	} else {
		displayMode = "unconfigured";
	}

	return (
		<ImChannelCardView
			name={name}
			subtitle={subtitle}
			icon={icon}
			configured={configured}
			isActive={isActive}
			effectiveStatus={effectiveStatus as ImStatusBadgeStatus}
			displayMode={displayMode}
			onConfigure={onConfigure}
			onActivate={onActivate}
			labels={{
				channelActive: t("channelActive"),
				channelConfigured: t("channelConfigured"),
				channelNotAssociated: t("channelNotAssociated"),
				channelPending: t("channelPendingStatus"),
				activateChannelTitle: t("activateChannelTitle"),
				configureLabel,
				statusLabel: t(STATUS_LABEL[effectiveStatus] as "imbStatusOffline"),
			}}
		/>
	);
}
