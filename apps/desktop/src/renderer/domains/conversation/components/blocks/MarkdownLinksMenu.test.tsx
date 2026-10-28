// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMarkdownHostFixture } from "./markdown-host.fixture";
beforeEach(() =>
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	),
);
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const props = {
	theme: "dark" as const,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "",
	onOpenFile: vi.fn(),
	onOpenUrl: vi.fn(),
};
it("keeps Markdown closing markers outside an automatically recognized website card", () => {
	render(
		<MarkdownContent {...props} text={"已为你预设好 使用 IPv6 与 **获取 IP 来源 (Web: https://v6.ident.me)**。"} />,
	);
	const link = screen.getByRole("link");
	expect(link.getAttribute("href")).toBe("https://v6.ident.me");
	expect(link.textContent).not.toContain("**");
});
it("opens and copies a URL through a themed context menu without activating the link", async () => {
	const { host } = createMarkdownHostFixture();
	const copyText = vi.fn(async () => {});
	const openUrl = vi.fn();
	const openInApp = vi.fn();
	render(
		<MarkdownContent
			{...props}
			onOpenUrl={openInApp}
			host={{ ...host, copyText, openExternalUrl: openUrl }}
			text="[Website](https://example.test/a?q=1)"
		/>,
	);
	const link = screen.getByRole("link", { name: "Website" });
	fireEvent.contextMenu(link, { clientX: 15, clientY: 20 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /Copy link/i }));
	await waitFor(() => expect(copyText).toHaveBeenCalledWith("https://example.test/a?q=1", "url"));
	expect(openUrl).not.toHaveBeenCalled();
	expect(openInApp).not.toHaveBeenCalled();
	fireEvent.contextMenu(link, { clientX: 15, clientY: 20 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /default browser/i }));
	await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.test/a?q=1"));
	expect(openInApp).not.toHaveBeenCalled();
});
it("offers the same file actions for an inline file and an artifact list", async () => {
	const { host } = createMarkdownHostFixture();
	const copyText = vi.fn(async () => {});
	const revealFile = vi.fn(async () => {});
	render(
		<MarkdownContent
			{...props}
			host={{ ...host, copyText, revealFile }}
			text={"[File](./docs/readme.md)\n\n- [Other](./other.md)"}
		/>,
	);
	const file = screen.getByRole("button", { name: "File" });
	fireEvent.contextMenu(file, { clientX: 10, clientY: 10 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /Copy path/i }));
	await waitFor(() => expect(copyText).toHaveBeenCalledWith("./docs/readme.md", "file"));
	fireEvent.contextMenu(screen.getByRole("button", { name: "other.md" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: /file manager/i }));
	await waitFor(() => expect(revealFile).toHaveBeenCalledWith("./other.md"));
});

it("does not alter explicit URL parameters or links inside code", () => {
	render(
		<MarkdownContent
			{...props}
			text={
				"[Wildcard](<https://example.test/a?pattern=**>)\n\n`https://example.test/code**`\n\n**See https://example.test/path_(a)**。"
			}
		/>,
	);
	expect(screen.getByRole("link", { name: "Wildcard" }).getAttribute("href")).toBe(
		"https://example.test/a?pattern=**",
	);
	expect(screen.getAllByRole("link")).toHaveLength(2);
	expect(screen.getAllByRole("link")[1].getAttribute("href")).toBe("https://example.test/path_(a)");
});

it("opens the original LAN destination when the Markdown link label starts on the next line", async () => {
	const open = vi.fn();
	const { host } = createMarkdownHostFixture();
	const external = vi.fn();
	render(
		<MarkdownContent
			{...props}
			onOpenUrl={open}
			host={{ ...host, openExternalUrl: external }}
			text={
				"全新的品牌现已在 [\nhttps://192.168.1.219:8089](https://192.168.1.219:8089)\n 与 [\nhttp://192.168.1.219:8088](http://192.168.1.219:8088)\n 持续在线运行，随时可以使用！"
			}
		/>,
	);
	const links = screen.getAllByRole("link");
	expect(links).toHaveLength(2);
	expect(links.map((link) => link.getAttribute("href"))).toEqual([
		"https://192.168.1.219:8089",
		"http://192.168.1.219:8088",
	]);
	for (const link of links) expect(link.textContent).not.toMatch(/[\[\]()]/);
	fireEvent.click(links[0]);
	expect(open).toHaveBeenCalledWith("https://192.168.1.219:8089");
	fireEvent.contextMenu(links[1], { clientX: 10, clientY: 10 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /default browser/i }));
	await waitFor(() => expect(external).toHaveBeenCalledWith("http://192.168.1.219:8088"));
});

it("recovers the duplicated LAN URL suffix swallowed by GFM after a broken link boundary", async () => {
	const { host } = createMarkdownHostFixture();
	const external = vi.fn();
	render(
		<MarkdownContent
			{...props}
			host={{ ...host, openExternalUrl: external }}
			text={
				"直接在浏览器中打开： 👉 [\n\nhttps://192.168.1.219:8089](https://192.168.1.219:8089)\n\n或 👉 [\n\nhttp://192.168.1.219:8088](http://192.168.1.219:8088)"
			}
		/>,
	);
	const links = screen.getAllByRole("link");
	expect(links.map((link) => link.getAttribute("href"))).toEqual([
		"https://192.168.1.219:8089",
		"http://192.168.1.219:8088",
	]);
	for (const link of links) expect(link.textContent).not.toMatch(/[\[\]()]/);
	fireEvent.contextMenu(links[0], { clientX: 10, clientY: 10 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /default browser/i }));
	await waitFor(() => expect(external).toHaveBeenCalledWith("https://192.168.1.219:8089"));
});

it("repairs the reported encoded duplicate target without changing deliberate destinations or code examples", async () => {
	const { host } = createMarkdownHostFixture();
	const copy = vi.fn(async () => {});
	const broken = "https://192.168.1.219:8089%5D(https://192.168.1.219:8089)";
	render(
		<MarkdownContent
			{...props}
			host={{ ...host, copyText: copy }}
			text={broken + "\n\n[Deliberate](<" + broken + ">)\n\n`" + broken + "`"}
		/>,
	);
	const links = screen.getAllByRole("link");
	expect(links).toHaveLength(2);
	expect(links[0].getAttribute("href")).toBe("https://192.168.1.219:8089");
	expect(links[1].getAttribute("href")).toBe(broken);
	expect(screen.getByText(broken).tagName).toBe("CODE");
	fireEvent.contextMenu(links[0], { clientX: 10, clientY: 10 });
	fireEvent.click(await screen.findByRole("menuitem", { name: /Copy link/i }));
	await waitFor(() => expect(copy).toHaveBeenCalledWith("https://192.168.1.219:8089", "url"));
});

it("keeps bold URL labels in a table intact through streaming, copying and opening", async () => {
	const { host } = createMarkdownHostFixture();
	const copy = vi.fn(async () => {});
	const external = vi.fn();
	const urls = [
		"https://a.567.wiki/",
		"https://epay.567.wiki/",
		"https://factory.567.wiki/",
		"https://3d.567.wiki/",
		"http://www.567.wiki/",
	];
	const text = "| 域名 | 端口 |\n| --- | --- |\n" + urls.map((url) => `| **[${url}](${url})** | 443 |`).join("\n");
	const view = render(
		<MarkdownContent
			{...props}
			host={{ ...host, copyText: copy, openExternalUrl: external }}
			text={text}
			isStreamingTail
		/>,
	);
	view.rerender(
		<MarkdownContent
			{...props}
			host={{ ...host, copyText: copy, openExternalUrl: external }}
			text={text}
			isStreamingTail={false}
		/>,
	);
	await waitFor(() => expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(urls));
	const links = screen.getAllByRole("link");
	for (const cell of screen.getAllByRole("cell")) expect(cell.textContent).not.toMatch(/[\[\]]|%5D|\]\(/i);
	fireEvent.contextMenu(links[0]);
	fireEvent.click(await screen.findByRole("menuitem", { name: /Copy link/i }));
	await waitFor(() => expect(copy).toHaveBeenCalledWith(urls[0], "url"));
	fireEvent.contextMenu(links[1]);
	fireEvent.click(await screen.findByRole("menuitem", { name: /default browser/i }));
	await waitFor(() => expect(external).toHaveBeenCalledWith(urls[1]));
});

it("preserves a named bold URL label and explicit target alongside a bare emphasized URL", () => {
	render(
		<MarkdownContent
			{...props}
			text={
				"**[Home https://example.test/](https://example.test/target)**\n\n**See https://example.test/bare**。\n\n`**[https://example.test/](https://example.test/)**`"
			}
		/>,
	);
	expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
		"https://example.test/target",
		"https://example.test/bare",
	]);
	expect(screen.getByRole("link", { name: "Home https://example.test/" })).toBeTruthy();
});
