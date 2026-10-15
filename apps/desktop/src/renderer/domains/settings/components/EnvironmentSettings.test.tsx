// @vitest-environment jsdom
import { i18n, initI18n } from "@shared/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentSettings } from "./EnvironmentSettings";

vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
let bridgeDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
	bridgeDescriptor = Object.getOwnPropertyDescriptor(window, "agent567");
	initI18n();
	await i18n.changeLanguage("en");
});
afterEach(() => {
	if (bridgeDescriptor) Object.defineProperty(window, "agent567", bridgeDescriptor);
	else Reflect.deleteProperty(window, "agent567");
});

function fixture(pythonSupported = false) {
	let repairRequiresRestart = false;
	let ready = false;
	let notify: () => void = () => undefined;
	const getStatus = vi.fn(async () => ({
		node: { type: "node", ready, supported: true, repairRequiresRestart, managedVersion: ready ? "22.22.2" : undefined, recommendedVersion: "22.22.2", activeSource: "managed" },
		python: { type: "python", ready: false, supported: pythonSupported, recommendedVersion: "3.13.12", activeSource: "managed" },
		mirrors: { npmRegistry: "https://example.test/npm", pipIndexUrl: "https://example.test/pip" },
	}));
	const reinstall = vi.fn(async (): Promise<{ ready: boolean }> => { repairRequiresRestart = true; throw new Error("Runtime files are in use"); });
	const restartAndRepair = vi.fn(async () => undefined);
	Object.defineProperty(window, "agent567", { configurable: true, value: {
		runtimes: { getStatus, reinstall, restartAndRepair, onProgress: () => () => undefined,
			onStatusChanged: (listener: () => void) => { notify = listener; return () => { notify = () => undefined; }; },
		},
	} });
	return { getStatus, reinstall, restartAndRepair, completeBackgroundRepair: () => { ready = true; repairRequiresRestart = false; notify(); } };
}

describe("environment repair flow", () => {
    it("serializes user repairs and disables both runtime buttons until the active operation finishes", async () => {
        const { reinstall, getStatus } = fixture(true);
        let complete!: (value: { ready: boolean }) => void;
        reinstall.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const user = userEvent.setup();
        render(<EnvironmentSettings />);
        const buttons = await screen.findAllByRole("button", { name: "Fetch" });
        await user.click(buttons[0]);
        expect(buttons[0]).toHaveProperty("disabled", true);
        expect(buttons[1]).toHaveProperty("disabled", true);
        await user.click(buttons[1]);
        expect(reinstall).toHaveBeenCalledOnce();
        getStatus.mockResolvedValue({ ...(await getStatus()), node: { ...(await getStatus()).node, ready: true } });
        await act(async () => { complete({ ready: true }); });
        await waitFor(() => expect(buttons[1]).toHaveProperty("disabled", false));
    });

	it("updates the page when background recovery completes", async () => {
		const { completeBackgroundRepair } = fixture();
		render(<EnvironmentSettings />);
		await screen.findByRole("button", { name: "Fetch" });
		await act(async () => { completeBackgroundRepair(); });
		expect(await screen.findByText("Ready · 22.22.2")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Fetch again" })).toBeTruthy();
	});
	it("offers restart and repair after an occupied runtime prevents reinstall", async () => {
		const { reinstall, restartAndRepair } = fixture();
		const user = userEvent.setup();
		render(<EnvironmentSettings />);
		await user.click(await screen.findByRole("button", { name: "Fetch" }));
		const restart = await screen.findByRole("button", { name: "Restart and repair" });
		expect(screen.getByText(/Stops tasks to repair the environment/)).toBeTruthy();
		await user.click(restart);
		await waitFor(() => expect(restartAndRepair).toHaveBeenCalledWith("node"));
		expect(reinstall).toHaveBeenCalledOnce();
		expect(restart).toHaveProperty("disabled", true);
	});

	it("keeps the restart button usable when saving the restart request fails", async () => {
		const { restartAndRepair } = fixture();
		restartAndRepair.mockRejectedValue(new Error("Repair request could not be saved"));
		const user = userEvent.setup();
		render(<EnvironmentSettings />);
		await user.click(await screen.findByRole("button", { name: "Fetch" }));
		await user.click(await screen.findByRole("button", { name: "Restart and repair" }));
		expect(await screen.findByText(/Repair request could not be saved/)).toBeTruthy();
		await waitFor(() => expect(screen.getByRole("button", { name: "Restart and repair" })).toHaveProperty("disabled", false));
	});
});
