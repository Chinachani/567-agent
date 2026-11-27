import { describe, expect, it } from "vitest";
import { parseMoreToolsGitHubProxyPrefixes, resolveGitHubUpdateProxyPrefix } from "./github-download-source";

describe("GitHub download source discovery", () => {
	it("extracts safe HTTPS prefixes from MoreTools markup", () => {
		expect(
			parseMoreToolsGitHubProxyPrefixes(
				"<span>https://gh-proxy.net/</span><span>https://gh-proxy.net/</span><span>http://unsafe.example/</span>" +
					'<a href="https://www.moretools.app/zh-CN/">MoreTools</a>' +
					'<script src="https://www.googlesyndication.com/pagead/script.js"></script>' +
					'<a href="https://github.com/example/">GitHub</a>',
			),
		).toEqual(["https://gh-proxy.net/"]);
	});

	it("leaves automatic discovery for the async resolver", () => {
		expect(resolveGitHubUpdateProxyPrefix("auto", undefined)).toBeNull();
	});
});
