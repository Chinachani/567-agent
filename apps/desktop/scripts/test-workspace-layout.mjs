import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "agent567-workspace-layout-"));
const artifacts = process.env.AGENT567_LAYOUT_ARTIFACT_DIR;
const pageFilter = process.env.AGENT567_LAYOUT_PAGES?.split(",").filter(Boolean);
let display;
try {
	if (artifacts) await mkdir(artifacts, { recursive: true });
	await symlink(join(desktop, "node_modules"), join(root, "node_modules"), "dir");
	await writeFile(join(root, "index.html"), '<div id="root"></div><script type="module" src="/entry.jsx"></script>');
	await writeFile(
		join(root, "entry.jsx"),
		`localStorage.setItem("vetta-hero-ornament","none");await import(${JSON.stringify(join(desktop, "scripts/fixtures/workspace-redesign.jsx"))});`,
	);
	await writeFile(
		join(root, "fixture.css"),
		`@import ${JSON.stringify(join(desktop, "src/renderer/styles.css"))};\n@source ${JSON.stringify(join(desktop, "src/renderer"))};\n@source ${JSON.stringify(join(desktop, "scripts/fixtures/workspace-redesign.jsx"))};`,
	);
	await build({
		configFile: false,
		root,
		base: "./",
		publicDir: join(desktop, "src/renderer/public"),
		logLevel: "warn",
		esbuild: { jsx: "automatic" },
		resolve: {
			alias: {
				"@": join(desktop, "src"),
				"@shared": join(desktop, "src/renderer/shared"),
				"@preload": join(desktop, "src/preload"),
				"@domains": join(desktop, "src/renderer/domains"),
				"@cloud": join(desktop, "src/renderer/cloud"),
			},
		},
		plugins: [
			tailwindcss(),
			{
				name: "isolated-workspace-host",
				enforce: "pre",
				resolveId(source, importer) {
					if (source === "./fixture.css" && importer?.endsWith("workspace-redesign.jsx"))
						return join(root, "fixture.css");
					if (source === "@tanstack/react-router") return "\0fixture-router";
					if (importer?.endsWith("/api567/index.ts") && source === "./hooks/useApi567") return "\0fixture-account";
				},
				load(id) {
					if (id === "\0fixture-router")
						return "export const useNavigate=()=>value=>window.workspaceEvents.push('navigate:'+JSON.stringify(value));export const useLocation=()=>({pathname:'/'});export const useSearch=()=>({});";
					if (id === "\0fixture-account")
						return `export const useApi567=()=>({status:{isLoggedIn:true,username:"夜雨寄北",loginUsername:"Yeyu",quotaUsd:62.53},availableGroups:{},groupsLoadState:{loading:false,error:false,loaded:true},loadAvailableGroups:async()=>{}});`;
				},
			},
		],
		build: { outDir: join(root, "out"), target: "esnext" },
	});
	const runner = join(root, "runner.cjs");
	await writeFile(runner, "(" + runProbe.toString() + ")(" + JSON.stringify({ root, artifacts, pageFilter }) + ");");
	display = spawn(
		process.env.AGENT567_TEST_XVFB ?? "Xvfb",
		["-displayfd", "1", "-screen", "0", "1600x1000x24", "-nolisten", "tcp"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const [number] = await Promise.race([
		once(display.stdout, "data"),
		once(display, "error").then(([error]) => {
			throw error;
		}),
	]);
	const env = { ...process.env, DISPLAY: ":" + number.toString().trim() };
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(
		process.env.AGENT567_TEST_ELECTRON ?? createRequire(import.meta.url)("electron"),
		["--no-sandbox", runner],
		{ env, stdio: ["ignore", "pipe", "pipe"], timeout: 210000 },
	);
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});
	const [code, signal] = await once(child, "exit");
	assert.equal(code, 0, `Workspace layout exited ${code}/${signal}: ${output}`);
	if (artifacts) await writeFile(join(artifacts, "workspace-probe-output.log"), output);
	const match = output.match(/WORKSPACE_LAYOUT_RESULT (\{[^\n]+\})/);
	assert.ok(match, output);
	const result = JSON.parse(match[1]);
	assert.equal(result.rows.length, (pageFilter?.length ?? 18) * 6);
	for (const row of result.rows) {
		assert.ok(row.title, JSON.stringify(row));
		assert.ok(row.controls > 0, JSON.stringify(row));
		assert.ok(row.overflow <= 1, JSON.stringify(row));
		assert.deepEqual(row.clipped, [], JSON.stringify(row));
		assert.deepEqual(row.missingHit, [], JSON.stringify(row));
	}
	for (const event of [
		"model:fixture/code-model",
		"tool-toggle",
		"file",
		"image",
		"send",
		"template:brief",
		"new-task",
		"new-project",
		"new-kb",
	])
		assert.ok(result.events.includes(event), JSON.stringify(result.events));
	assert.deepEqual(result.errors, []);
	if (artifacts) await writeFile(join(artifacts, "workspace-layout.json"), JSON.stringify(result, null, 2));
	console.log("WORKSPACE_LAYOUT_PASSED", JSON.stringify({ scenarios: result.rows.length, events: result.events }));
} finally {
	if (display?.pid && display.exitCode === null && display.signalCode === null) {
		const closed = once(display, "exit");
		display.kill();
		await closed;
	}
	await rm(root, { recursive: true, force: true });
}

// Serialized into an isolated Electron process. No user profile or network access.
function runProbe({ root, artifacts, pageFilter }) {
	const { app, BrowserWindow, session } = require("electron"),
		fs = require("node:fs/promises"),
		path = require("node:path");
	app.disableHardwareAcceleration();
	app.setPath("userData", path.join(root, "profile"));
	app
		.whenReady()
		.then(async () => {
			session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) =>
				callback({ cancel: true }),
			);
			const win = new BrowserWindow({
				// This display belongs to the private Xvfb process. Keep its compositor
				// producing frames so capturePage cannot save a previous page's pixels.
				show: true,
				width: 1100,
				height: 780,
				webPreferences: { sandbox: true, backgroundThrottling: false },
			});
			const errors = [];
			win.webContents.on("console-message", (_event, level, message) => {
				if (level >= 3) errors.push(message);
			});
			const call = async (fn, arg) => {
				let timer;
				try {
					const result = await Promise.race([
						win.webContents.executeJavaScript(
							"Promise.resolve().then(()=>(" +
								fn.toString() +
								")(" +
								JSON.stringify(arg ?? null) +
								")).catch(error=>({__error:String(error.stack)}))",
						),
						new Promise((_, reject) => {
							timer = setTimeout(() => reject(Error("UI operation timed out: " + fn.toString().slice(0, 180))), 5000);
						}),
					]);
					if (result?.__error) throw Error(result.__error + "\nRenderer errors: " + errors.slice(-5).join("\n"));
					return result;
				} finally {
					clearTimeout(timer);
				}
			};
			await win.loadFile(path.join(root, "out/index.html"));
			await call(
				() =>
					new Promise((resolve, reject) => {
						// Frame-starved hidden windows never fire rAF; poll on a timer instead.
						const check = () => (window.renderWorkspace ? resolve() : setTimeout(check, 50));
						check();
						setTimeout(() => reject(Error("Fixture did not initialize")), 10000);
					}),
			);
			const render = async (state) =>
				call(async (state) => {
					window.renderWorkspace(state);
					// Hidden windows stop producing frames after a resize, so poll on timers instead of rAF.
					await new Promise((resolve) => {
						const started = Date.now();
						const check = () => {
							if (document.querySelector('[data-workspace-page="' + state.page + '"]')) return resolve();
							if (Date.now() - started > 4000) return resolve();
							setTimeout(check, 50);
						};
						check();
					});
					await new Promise((r) => setTimeout(r, 120));
					// Jump every finite animation to its end state: frame-starved windows never finish them.
					document.getAnimations().forEach((a) => {
						if (Number.isFinite(a.effect.getComputedTiming().endTime)) {
							try {
								a.finish();
							} catch {}
						}
					});
				}, state);
			const rows = [];
			const started = Date.now();
			for (const mode of ["dark", "light"])
				for (const width of [380, 800, 1100])
					for (const page of [
						"home",
						"chat",
						"automation",
						"automationReady",
						"batch",
						"settings",
						"abilities",
						"skills",
						"knowledge",
                        "taskQueue", "taskQueueCollapsed", "updates", "taskRunning", "taskWaiting", "taskFailed", "taskStopped", "taskComplete", "deliveries",
                    ]) {
                        if (pageFilter && !pageFilter.includes(page)) continue;
						win.setContentSize(width, 780);
						// Resizes apply asynchronously; wait until the content size settles so the page
						// measures the requested width instead of the previous one.
						await new Promise((resolve) => {
							let stable = 0;
							let last = "";
							const timer = setInterval(() => {
								const current = win.getContentSize().join("x");
								if (current === last) {
									if (++stable >= 5) {
										clearInterval(timer);
										resolve();
									}
								} else {
									stable = 0;
									last = current;
								}
							}, 100);
							setTimeout(() => {
								clearInterval(timer);
								resolve();
							}, 4000);
						});
						await call((mode) => window.applyWorkspaceTheme(mode), mode);
						await render({ page, shell: width === 1100 });
						const row = await call((page) => {
							const body = document.querySelector('[data-workspace-page="' + page + '"]'),
								bounds = body.getBoundingClientRect();
							const controls = [...body.querySelectorAll('button,input,select,[role="textbox"]')].filter((el) => {
								const r = el.getBoundingClientRect();
								return r.width && r.height && r.bottom > 0 && r.top < innerHeight;
							});
							const label = (el) => el.textContent || el.getAttribute("aria-label") || el.title;
							const clipped = controls
								.filter((el) => {
									const r = el.getBoundingClientRect();
									return r.left < bounds.left - 1 || r.right > bounds.right + 1;
								})
								.map(label);
							const missingHit = controls
								.filter((el) => {
									const r = el.getBoundingClientRect();
									if (r.top < 0 || r.bottom > innerHeight || el.disabled) return false;
									const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
									return el !== target && !el.contains(target);
								})
								.map(label);
                            const abilityCards = page === "abilities" ? [...body.querySelectorAll('button[aria-label^="查看 "]')].map(button => {
                                const card = button.parentElement, r = card.getBoundingClientRect();
                                const visible = r.top >= 0 && r.bottom <= innerHeight;
                                const target = visible ? document.elementFromPoint(r.left + 6, r.bottom - 6) : button;
                                const add = card.querySelector('button[aria-label="添加"]');
                                const a = add?.getBoundingClientRect();
                                // Hit-testing an off-screen add button is meaningless; elementFromPoint returns null there.
                                const addVisible = a && a.top >= 0 && a.bottom <= innerHeight;
                                return { height: r.height, contentFits: card.scrollHeight <= card.clientHeight + 1, paddingOpensDetails: target === button || button.contains(target), addClickable: !add || !addVisible || add.contains(document.elementFromPoint(a.x + a.width/2, a.y + a.height/2)) };
                            }) : [];
                            if (abilityCards.some(card => card.height !== 144 || !card.contentFits || !card.paddingOpensDetails || !card.addClickable)) throw Error("Ability card layout or hit area failed: " + JSON.stringify(abilityCards));
                            const taskStatus = page.startsWith("task") ? body.querySelector("output") : null;
                            if (taskStatus) {
                                const info = taskStatus.closest("section").firstElementChild.getBoundingClientRect();
                                const composer = body.querySelector(".input-card").getBoundingClientRect();
                                if (Math.abs(info.left-composer.left)>1 || Math.abs(info.right-composer.right)>1) throw Error("Task progress and composer edges differ: "+JSON.stringify({info:info.toJSON(),composer:composer.toJSON()}));
                            }
                            if (page.startsWith("task")) {
                                const stops = [...body.querySelectorAll("button")].filter(el=>el.title === "停止生成" || el.textContent.trim() === "停止");
                                const expected = (["taskRunning","taskWaiting"].includes(page) || page.startsWith("taskQueue")) ? 1 : 0;
                                if (stops.length !== expected) throw Error("Task stop action count: "+JSON.stringify({page,count:stops.length,expected}));
                                if (["taskFailed","taskStopped","taskComplete"].includes(page) && !controls.some(el=>el.textContent.includes("从历史继续"))) throw Error("Missing explicit continuation on "+page);
                            }

                            if (page.startsWith("taskQueue")) {
                                const queue = body.querySelector('section[aria-label="队列"]');
                                const status = body.querySelector("output")?.closest("section");
                                const input = body.querySelector('[data-message-input-part="context-toolbar"]');
                                if (!queue || !status || !input) throw Error("Missing production queue/status/input");
                                const q = queue.getBoundingClientRect(), s = status.getBoundingClientRect(), i = input.getBoundingClientRect();
                                if (s.bottom > q.top + 1 || q.bottom > i.top + 1) throw Error("Queue overlaps status or input: "+JSON.stringify({page,q:q.toJSON(),s:s.toJSON(),i:i.toJSON()}));
                                if (Math.abs(q.width - i.width) > 3) throw Error("Queue and composer widths differ");
                                const tab = queue.querySelector("button");
                                if (tab.getAttribute("aria-expanded") !== String(page === "taskQueue")) throw Error("Queue expanded state mismatch");
                            }
							return {
								overflow: body.scrollWidth - body.clientWidth,
								clipped,
								missingHit,
								title: body.querySelector("h1")?.textContent,
								controls: controls.length,
                                abilityCards,
							};
						}, page);
						rows.push({ mode, width, page, ...row });
						if (artifacts)
							await fs.writeFile(
								path.join(artifacts, page + "-" + mode + "-" + width + ".png"),
								(await win.capturePage()).toPNG(),
							);
					}
			win.setContentSize(800, 780);
			await win.loadFile(path.join(root, "out/index.html"));
			await call(
				() =>
					new Promise((resolve) => {
						// Frame-starved hidden windows never fire rAF; poll on a timer instead.
						const check = () => (window.renderWorkspace ? resolve() : setTimeout(check, 50));
						check();
					}),
			);
			console.log("WORKSPACE_ACTIONS_START elapsedMs=" + (Date.now() - started));
			await render({ page: "home" });
			await call(async () => {
				const trigger = document.querySelector('button[title="Gemini Flash"]');
				trigger.focus();
				trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				await new Promise((resolve) => {
					const check = () =>
						document.querySelector('[data-model-key="fixture/code-model"]') ? resolve() : setTimeout(check, 50);
					check();
				});
				document.querySelector('[data-model-key="fixture/code-model"]').click();
			});
			await call(() => document.querySelector('[role="textbox"]').focus());
			await win.webContents.insertText("为项目整理一份实施计划");
			await call(() => new Promise((r) => setTimeout(r, 120)));
			await call(() => {
				document.querySelector('button[title="添加文件"]').click();
				document.querySelector('button[title="添加图片"]').click();
				document.querySelector('button[title="发送消息"]').click();
			});
			console.log("WORKSPACE_CHAT_ACTION");
			await render({ page: "chat" });
			console.log("WORKSPACE_CHAT_RENDERED");
			await call(() => {
				const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("src/project.ts"));
				button.click();
			});
			console.log("WORKSPACE_CHAT_CLICKED");
			await call(async () => {
				await new Promise((r) => setTimeout(r, 120));
				if (!document.querySelector('button[aria-expanded="true"]')) throw Error("Tool details did not expand");
			});
			await render({ page: "abilities" });
			const abilityPoints = await call(async () => {
				const button = document.querySelector('button[aria-label="查看 代码审阅 详情"]');
				button.scrollIntoView({ block: "center" });
				await new Promise((resolve) => setTimeout(resolve, 120));
				const card = button.parentElement;
				const r = card.getBoundingClientRect(), a = card.querySelector('button[aria-label="添加"]').getBoundingClientRect();
				return { details: { x: Math.round(r.left + 6), y: Math.round(r.bottom - 6) }, add: { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) }, before: window.workspaceEvents.length };
			});
			const click = (point) => {
				win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
				win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
			};
			click(abilityPoints.add);
			await call(async (before) => {
				await new Promise((resolve) => setTimeout(resolve, 120));
				const events = window.workspaceEvents.slice(before);
				if (JSON.stringify(events) !== JSON.stringify(["ability-install:fixture:0"])) throw Error("Add also opened details: " + JSON.stringify(events));
			}, abilityPoints.before);
			click(abilityPoints.details);
			await call(async (before) => {
				await new Promise((resolve) => setTimeout(resolve, 120));
				const events = window.workspaceEvents.slice(before);
				if (events.length !== 2 || !events[1].includes('"detail":"fixture:0"')) throw Error("Card padding did not open details: " + JSON.stringify(events));
			}, abilityPoints.before);
			await call(() => document.querySelector('input[aria-label="搜索能力"]').focus());
			await win.webContents.insertText("代码");
			await call(async () => {
				await new Promise((r) => setTimeout(r, 120));
				if (document.body.textContent.includes("浏览器自动化") || !document.body.textContent.includes("代码审阅"))
					throw Error("Ability search did not filter the real view");
			});
			await render({ page: "automation" });
			await call(() => {
				[...document.querySelectorAll("button")].find((b) => b.textContent.includes("每日工作简报")).click();
				[...document.querySelectorAll("button")].find((b) => b.textContent.includes("新建任务")).click();
			});
			await render({ page: "batch" });
			await call(() =>
				[...document.querySelectorAll("button")].find((b) => b.textContent.includes("创建第一个项目")).click(),
			);
			await render({ page: "knowledge" });
			await call(() =>
				[...document.querySelectorAll("button")].find((b) => b.textContent.includes("新建知识库")).click(),
			);
			const result = {
				elapsedMs: Date.now() - started,
				rows,
				events: await call(() => window.workspaceEvents),
				errors,
			};
			await new Promise((resolve) =>
				process.stdout.write("WORKSPACE_LAYOUT_RESULT " + JSON.stringify(result) + "\n", resolve),
			);
			win.destroy();
			app.exit(0);
		})
		.catch((error) => {
			console.error(error);
			app.exit(1);
		});
}
