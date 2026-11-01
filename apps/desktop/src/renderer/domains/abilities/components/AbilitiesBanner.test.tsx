// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeAll, expect, it } from "vitest";
import { AbilitiesBanner } from "./AbilitiesBanner";

beforeAll(() => initI18n());
afterEach(cleanup);

it.each(["zh", "en"])(
	"keeps %s setup guidance collapsed until requested, with all safety instructions available",
	async (language) => {
		await i18n.changeLanguage(language);
		const user = userEvent.setup();
		const view = render(<AbilitiesBanner />);
		const details = view.container.querySelector("details")!;
		const summary = view.container.querySelector("summary")!;
		expect(details.open).toBe(false);
		expect(screen.getByText(i18n.t("abilities:banner.summary"))).toBeTruthy();
		await user.click(summary);
		expect(details.open).toBe(true);
		expect(screen.getByText(i18n.t("abilities:banner.catalogHint"))).toBeTruthy();
		expect(screen.getByText(i18n.t("abilities:banner.unreviewedHint"))).toBeTruthy();
		await user.click(summary);
		expect(details.open).toBe(false);
	},
);
