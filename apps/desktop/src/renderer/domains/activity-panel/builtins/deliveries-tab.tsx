import { useTranslation } from "react-i18next";
import { ConversationDeliveries } from "../components/ConversationDeliveries";
import type { ActivityTabDefinition } from "../registry/types";

export const deliveriesTabDefinition: ActivityTabDefinition = {
	id: "deliveries",
	order: 5,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		return { label: t("deliveries.tab"), icon: "icon-[solar--box-linear]" };
	},
	component: ConversationDeliveries,
};
