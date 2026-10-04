// @vitest-environment jsdom
import type { GitHubMarketplaceOrigin, OpenMarketplaceAbility } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { Button } from "@shared/components/ui/button";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMcpAbilities } from "../lib/build-ability-items";
import { resolveAbilityPrimaryAction, resolveAbilityStatus } from "../lib/ability-detail-actions";
import type { AbilityItem } from "../types";
import { useDiscoveryDetail } from "./useDiscoveryDetail";

const translator = createInstance().getFixedT("en", "settings");
function item(slug: string): AbilityItem {
    const origin: GitHubMarketplaceOrigin = {kind: "github-marketplace", sourceId: "official", marketplace: "official", marketplaceVersion: "1", repository: "https://github.com/example/catalog", ref: "catalog"};
    const market: MarketAbility & {origin: GitHubMarketplaceOrigin} = {type: "mcp", slug, name: slug, description: "Summary", version: "1", license: "", author: "", icon: "", category: "cad-3d", tags: [], sha256: "", download_count: 0, config: {}, detail: {}, updated_at: "", detailDeferred: true, installable: false, reviewStatus: "unreviewed", origin};
    return buildMcpAbilities([market], {ledger: {}, skillManifest: {}, localSkills: [], plugins: [], mcpConfig: {mcpServers: {}}, oauthAuthByName: {}, mcpSetupStatus: {}, busyIds: new Set()}, translator)[0];
}
function full(slug: string): OpenMarketplaceAbility {
    return {slug, type: "mcp", name: slug, description: `Full ${slug}`, license: "MIT", version: "1", configVersion: 1, author: "Upstream", icon: "", category: "cad-3d", tags: [], config: {}, detail: {content: `Documentation ${slug}`}, origin: item(slug).origin as GitHubMarketplaceOrigin};
}
function View({row, open = true}: {row: AbilityItem; open?: boolean}) {
    const state = useDiscoveryDetail(row, open);
    return <div>
        <p>{state.item?.description}</p>
        <p>{state.item?.detail?.content}</p>
        {state.loading && <span role="status">Loading details</span>}
        {state.error && <Button onClick={state.retry}>Retry details</Button>}
        <span>{state.item && resolveAbilityPrimaryAction(state.item, resolveAbilityStatus(state.item)) === "none" ? "Browse only" : "Install enabled"}</span>
    </div>;
}
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe("discovery detail user flow", () => {
    it("shows summary immediately, exposes a recoverable detail failure and loads details on retry", async () => {
        const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(full("first"));
        vi.stubGlobal("vetta", {abilities: {getDiscoveryDetail: fetcher}});
        render(<View row={item("first")} />);
        expect(screen.getByText("Summary")).toBeTruthy();
        await screen.findByRole("button", {name: "Retry details"});
        await userEvent.click(screen.getByRole("button", {name: "Retry details"}));
        await screen.findByText("Full first");
        expect(screen.getByText("Documentation first")).toBeTruthy();
        expect(screen.getByText("Browse only")).toBeTruthy();
        expect(fetcher).toHaveBeenCalledWith("official", "first", "1");
    });
    it("ignores late detail responses after changing rows or closing the drawer", async () => {
        let resolveFirst!: (value: OpenMarketplaceAbility) => void;
        const first = new Promise<OpenMarketplaceAbility>((resolve) => {resolveFirst = resolve;});
        vi.stubGlobal("vetta", {abilities: {getDiscoveryDetail: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(full("second"))}});
        const view = render(<View row={item("first")} />);
        view.rerender(<View row={item("second")} />);
        await screen.findByText("Full second");
        await act(async () => resolveFirst(full("first")));
        expect(screen.queryByText("Full first")).toBeNull();
        expect(screen.getByText("Full second")).toBeTruthy();
        view.rerender(<View row={item("first")} open={false} />);
        await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    });
});
