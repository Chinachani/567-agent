import { describe, expect, it } from "vitest";
import {
	firstExplicit,
	replaceLastPathSegment,
	resolveDesktopReleaseConfig,
	toGithubEnv,
	toGithubOutput,
} from "./resolve-desktop-release-config.mjs";

describe("firstExplicit", () => {
	it("skips empty, default, and whitespace tokens", () => {
		expect(firstExplicit("", "default", "  ", "true")).toBe("true");
	});
});

describe("replaceLastPathSegment", () => {
	it("rewrites a URL channel segment", () => {
		expect(replaceLastPathSegment("https://releases.example.com/desktop/stable", "test")).toBe(
			"https://releases.example.com/desktop/test",
		);
	});

	it("rewrites a plain prefix", () => {
		expect(replaceLastPathSegment("desktop/stable", "test")).toBe("desktop/test");
	});

	it("leaves unrelated paths alone", () => {
		expect(replaceLastPathSegment("desktop/artifacts", "test")).toBe("desktop/artifacts");
	});
});

describe("resolveDesktopReleaseConfig", () => {
	it("defaults a fork-style tag run to open-source + GitHub Releases", () => {
		expect(resolveDesktopReleaseConfig({ eventName: "push", refType: "tag", vars: {} })).toMatchObject({
			channel: "default",
			cloudEnabled: "false",
			marketplaceRepository: "",
			marketplaceRef: "main",
			releaseTarget: "github",
			shouldPublish: true,
			updateProvider: "github",
			api567BaseUrl: "",
		});
	});

	it("passes the selected marketplace ref through release outputs and build environment", () => {
		const fromVars = resolveDesktopReleaseConfig({
			eventName: "push",
			refType: "tag",
			vars: { AGENT567_OPEN_MARKETPLACE_REF: "marketplace-v3" },
		});
		expect(fromVars.marketplaceRef).toBe("marketplace-v3");
		expect(toGithubOutput(fromVars)).toContain("marketplace_ref=marketplace-v3");
		expect(toGithubEnv(fromVars)).toContain("AGENT567_OPEN_MARKETPLACE_REF=marketplace-v3");
		expect(resolveDesktopReleaseConfig({
			vars: { AGENT567_OPEN_MARKETPLACE_REF: "main" },
			inputs: { marketplace_ref: "marketplace-v3" },
		}).marketplaceRef).toBe("marketplace-v3");
		expect(resolveDesktopReleaseConfig({
			eventName: "push",
			vars: { AGENT567_OPEN_MARKETPLACE_REF: "main" },
			inputs: { marketplace_ref: "marketplace-v3" },
		}).marketplaceRef).toBe("main");
	});

	it.each(["github", "r2"])("uses only explicit marketplace configuration for %s releases", (releaseTarget) => {
		const vars = {
			AGENT567_RELEASE_TARGET: releaseTarget,
			API567_BASE_URL: "https://api.example.com/api/v1",
			AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
		};
		expect(resolveDesktopReleaseConfig({ vars }).marketplaceRepository).toBe("");
		const configured = { ...vars, AGENT567_OPEN_MARKETPLACE_REPOSITORY: "example/catalog" };
		const fromVars = resolveDesktopReleaseConfig({ vars: configured });
		expect(fromVars.marketplaceRepository).toBe("example/catalog");
		expect(toGithubEnv(fromVars)).toContain("AGENT567_OPEN_MARKETPLACE_REPOSITORY=example/catalog");
		expect(resolveDesktopReleaseConfig({
			vars: configured,
			inputs: { marketplace_repository: "example/override" },
		}).marketplaceRepository).toBe("example/override");
		expect(resolveDesktopReleaseConfig({
			eventName: "push",
			vars: configured,
			inputs: { marketplace_repository: "example/ignored" },
		}).marketplaceRepository).toBe("example/catalog");
	});

	it("uses Environment/repo vars on a tag and ignores leftover form inputs", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "push",
			inputs: { cloud_enabled: "false", api567_base_url: "https://evil.example" },
			vars: {
				AGENT567_CLOUD_ENABLED: "true",
				AGENT567_RELEASE_TARGET: "r2",
				API567_BASE_URL: "https://api.example.com/api/v1",
				AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config).toMatchObject({
			cloudEnabled: "true",
			releaseTarget: "r2",
			api567BaseUrl: "https://api.example.com/api/v1",
			updateProvider: "generic",
			updateUrl: "https://releases.example.com/desktop/stable",
		});
	});

	it("does not read the old NEWAPI_BASE_URL release variable", () => {
		expect(() => resolveDesktopReleaseConfig({
			vars: {
				AGENT567_RELEASE_TARGET: "r2",
				NEWAPI_BASE_URL: "https://legacy.example.com/api/v1",
			},
		})).toThrow(/API567_BASE_URL/);
	});

	it("lets workflow_dispatch inputs override vars", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: {
				channel: "test",
				cloud_enabled: "true",
				release_target: "r2",
				api567_base_url: "https://api.staging.example.com/api/v1",
			},
			vars: {
				AGENT567_CLOUD_ENABLED: "true",
				AGENT567_R2_PREFIX: "desktop/stable",
				API567_BASE_URL: "https://api.example.com/api/v1",
				AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config.api567BaseUrl).toBe("https://api.staging.example.com/api/v1");
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/test");
		expect(config.r2Prefix).toBe("desktop/test");
	});

	it("marks only explicit stable/test dispatches and matching tags for publication", () => {
		expect(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "stable" },
			}),
		).toMatchObject({ shouldPublish: true });
		expect(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "default" },
			}),
		).toMatchObject({ shouldPublish: false });
		expect(
			resolveDesktopReleaseConfig({
				eventName: "push",
				refType: "branch",
				vars: {},
			}),
		).toMatchObject({ shouldPublish: false });
	});

	it("prefers dedicated test vars over last-segment rewrite", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { channel: "test", release_target: "r2" },
			vars: {
				API567_BASE_URL: "https://api.example.com/api/v1",
				AGENT567_R2_PREFIX: "desktop/stable",
				AGENT567_R2_PREFIX_TEST: "desktop/nightly",
				AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
				AGENT567_UPDATE_URL_TEST: "https://releases.example.com/desktop/nightly",
			},
		});
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/nightly");
		expect(config.r2Prefix).toBe("desktop/nightly");
	});

	it("allows an explicit monotonic test build version only on the test channel", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { channel: "test", build_version: "0.5.47", release_target: "r2" },
			vars: {
				API567_BASE_URL: "https://api.example.com/api/v1",
				AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config.buildVersion).toBe("0.5.47");
		expect(toGithubEnv(config)).toContain("AGENT567_DESKTOP_BUILD_VERSION=0.5.47");
		expect(toGithubEnv(config)).toContain("AGENT567_RELEASE_PUBLISH=true");
		expect(toGithubOutput(config)).toContain("build_version=0.5.47");
	});

	it("rejects a test build version on stable or with an invalid version", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "stable", build_version: "0.5.47" },
			}),
		).toThrow(/only allowed for the test channel/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "test", build_version: "0.5", release_target: "r2" },
			}),
		).toThrow(/semantic desktop version/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "test", release_target: "github" },
			}),
		).toThrow(/test channel must publish to R2/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "push",
				vars: {
					AGENT567_RELEASE_CHANNEL: "test",
					AGENT567_RELEASE_TARGET: "r2",
					API567_BASE_URL: "https://api.example.com/api/v1",
				},
			}),
		).toThrow(/only available through workflow_dispatch/);
	});

	it("rejects a full build without a server URL", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { cloud_enabled: "true", release_target: "r2" },
				vars: {},
			}),
		).toThrow(/API567_BASE_URL/);
	});

	it("allows commercial builds on GitHub Releases and uses the generic updater feed", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { release_target: "github", cloud_enabled: "true", channel: "stable" },
			vars: {
				API567_BASE_URL: "https://api.567.wiki/api/v1",
				AGENT567_UPDATE_URL: "https://github.com/Chinachani/567-agent/releases/latest/download",
			},
		});
		expect(config).toMatchObject({
			releaseTarget: "github",
			cloudEnabled: "true",
			api567BaseUrl: "https://api.567.wiki/api/v1",
			updateProvider: "generic",
			updateUrl: "https://github.com/Chinachani/567-agent/releases/latest/download",
			shouldPublish: true,
		});
	});

	it("requires a generic updater URL for commercial GitHub Releases", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "github", cloud_enabled: "true" },
				vars: { API567_BASE_URL: "https://api.567.wiki/api/v1" },
			}),
		).toThrow(/AGENT567_UPDATE_URL/);

		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "r2", cloud_enabled: "false" },
			}),
		).toThrow(/commercial build/);
	});

	it("omits empty optional keys from GITHUB_ENV", () => {
		const env = toGithubEnv(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "r2" },
				vars: {
					API567_BASE_URL: "https://api.example.com/api/v1",
					AGENT567_UPDATE_URL: "https://releases.example.com/desktop/stable",
				},
			}),
		);
		expect(env).toContain("AGENT567_UPDATE_PROVIDER=generic");
		expect(env).toContain("AGENT567_UPDATE_URL=https://releases.example.com/desktop/stable");
		expect(env).toContain("AGENT567_CLOUD_ENABLED=true");
		expect(env).toContain("API567_BASE_URL=https://api.example.com/api/v1");
		expect(env).not.toContain("AGENT567_TENANT=");
	});

	it("writes GitHub output lines for the workflow", () => {
		const output = toGithubOutput(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "github", notes: "rehearsal" },
			}),
		);
		expect(output).toContain("release_target=github");
		expect(output).toContain("notes=rehearsal");
		expect(output).toContain("update_provider=github");
	});
});
