import type { JSX } from "react";
import { SettingsMenuActionButton } from "./SettingsMenuActionButton";

export interface SettingsMenuAccountSectionProps {
	loggedIn: boolean;
	logoutLabel: string;
	onLogout: () => void;
}

export function SettingsMenuAccountSection({
	loggedIn,
	logoutLabel,
	onLogout,
}: SettingsMenuAccountSectionProps): JSX.Element | null {
	if (!loggedIn) return null;

	return (
		<SettingsMenuActionButton icon="icon-[solar--logout-2-linear]" onClick={onLogout}>
			{logoutLabel}
		</SettingsMenuActionButton>
	);
}
