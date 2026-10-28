import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build, createServer } from "vite";

// Vite's config/dependency loader can spin under Bun before returning a server.
// Keep this probe on Node, matching the repository Vitest and layout wrappers.
if (process.versions.bun) throw new Error("Use bun run test:canvas-gestures (the script runs with Node).");
const phase = (name) => console.log(`[canvas-e2e] ${name}`);
phase("prepare isolated engine");
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = resolve(desktop, "../../packages/plugins/presets/vetta-ui-design");
const artifacts = process.env.AGENT567_CANVAS_ARTIFACT_DIR;
const root = await mkdtemp(join(tmpdir(), "agent567-canvas-e2e-"));
let display;
let engine;
try {
	if (artifacts) await mkdir(artifacts, { recursive: true });
	await cp(join(plugin, "engine"), join(root, "engine"), {
		recursive: true,
		filter: (path) => !path.includes("node_modules") && !path.includes("/dist/"),
	});
	const cached = process.env.AGENT567_CANVAS_ENGINE_DIR;
	if (cached) await symlink(join(cached, "node_modules"), join(root, "engine/node_modules"), "dir");
	else {
		phase("install cold engine dependencies");
		const install = spawn("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: join(root, "engine"),
			stdio: "inherit",
			timeout: 120000,
		});
		assert.equal((await once(install, "exit"))[0], 0, "engine dependencies failed to install");
	}
	const design = join(root, "design");
	await mkdir(join(design, "frames"), { recursive: true });
	await writeFile(join(design, "theme.css"), "@theme { --color-canvas-fixture: #123456; }\n");
	await writeFile(join(design, "design.json"), '{"viewport":{"x":0,"y":0,"zoom":1}}');
	const frame = (padding) =>
		`export default function Frame(){return <main className="bg-canvas-fixture ${padding}" data-test-frame>Canvas gesture fixture</main>}`;
	await writeFile(join(design, "frames/index.tsx"), frame("p-4"));
	await writeFile(
		join(design, "frames/_layout.tsx"),
		'import {Outlet} from "react-router"; export default function Layout(){return <section data-test-layout><Outlet/></section>}',
	);
	process.env.VETD_SRC = design;
	const portProbe = createNetServer();
	await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
	const enginePort = portProbe.address().port;
	await new Promise((resolve, reject) => portProbe.close((error) => (error ? reject(error) : resolve())));
	phase("create Vite engine");
	engine = await createServer({
		root: join(root, "engine"),
		configFile: join(root, "engine/vite.config.mjs"),
		server: {
			host: "127.0.0.1",
			port: enginePort,
			fs: { allow: [join(root, "engine"), design, ...(cached ? [cached] : [])] },
		},
		logLevel: "error",
	});
	const reloads = [];
	const send = engine.ws.send.bind(engine.ws);
	engine.ws.send = (...args) => {
		if (args[0]?.type === "full-reload") reloads.push(args[0]);
		return send(...args);
	};
	phase("listen Vite engine");
	await engine.listen();
	const address = engine.httpServer.address();
	assert.ok(address && typeof address !== "string");
	const port = address.port;
	await symlink(join(desktop, "node_modules"), join(root, "node_modules"), "dir");
	await writeFile(join(root, "index.html"), '<div id="root"></div><script type="module" src="/entry.jsx"></script>');
	await writeFile(
		join(root, "entry.jsx"),
		`import ${JSON.stringify(join(desktop, "scripts/fixtures/canvas-gestures.jsx"))};`,
	);
	await writeFile(
		join(root, "fixture.css"),
		`@import ${JSON.stringify(join(plugin, "src/style.css"))};\n@source ${JSON.stringify(join(plugin, "src/canvas"))};`,
	);
	phase("build host fixture");
	await build({
		configFile: false,
		root,
		base: "./",
		logLevel: "error",
		resolve: { dedupe: ["react", "react-dom"] },
		esbuild: { jsx: "automatic" },
		plugins: [
			tailwindcss(),
			{
				name: "canvas-fixture-host",
				enforce: "pre",
				resolveId(source) {
					if (source === "@vetta-org/plugin-sdk") return "\0fixture-sdk";
					if (source === "./canvas-fixture.css") return join(root, "fixture.css");
				},
				load(id) {
					if (id === "\0fixture-sdk") return "export const useTranslation=()=>({t:k=>k});";
				},
			},
		],
		build: { outDir: join(root, "out"), target: "esnext" },
	});
	const runner = join(root, "runner.cjs");
	await writeFile(runner, `(${runProbe.toString()})(${JSON.stringify({ root, port, artifacts })});`);
	display = spawn(
		process.env.AGENT567_TEST_XVFB ?? "Xvfb",
		["-displayfd", "1", "-screen", "0", "1200x900x24", "-nolisten", "tcp"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const [number] = await Promise.race([
		once(display.stdout, "data"),
		once(display, "error").then(([error]) => {
			throw error;
		}),
	]);
	const env = { ...process.env, DISPLAY: `:${number.toString().trim()}` };
	delete env.ELECTRON_RUN_AS_NODE;
	phase("run Electron out-of-process gestures");
	const child = spawn(createRequire(import.meta.url)("electron"), ["--no-sandbox", runner], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 90000,
	});
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});
	// Observe a full HMR debounce window after a layout-only save. A real source edit
	// follows as a positive control so a disconnected watcher cannot falsely pass.
	child.stdout.on("data", (chunk) => {
		if (chunk.toString().includes("SAVE_LAYOUT"))
			void writeFile(join(design, "design.json"), '{"viewport":{"x":50,"y":80,"zoom":0.8}}');
		if (chunk.toString().includes("EDIT_FRAME")) void writeFile(join(design, "frames/index.tsx"), frame("p-8"));
	});
	const [code, signal] = await once(child, "exit");
	if (artifacts) await writeFile(join(artifacts, "electron.log"), output);
	assert.equal(code, 0, `Canvas probe ${code}/${signal}: ${output}`);
	assert.deepEqual(reloads, [], `Layout-only writes unexpectedly reloaded engine: ${JSON.stringify(reloads)}`);
	console.log(output);
	console.log("CANVAS_E2E_PASSED", JSON.stringify({ reloads: reloads.length }));
} finally {
	await engine?.close();
	if (display?.pid && display.exitCode === null && display.signalCode === null) {
		const closed = once(display, "exit");
		display.kill();
		await closed;
	}
	await rm(root, { recursive: true, force: true });
}

function runProbe({ root, port, artifacts }) {
	const { app, BrowserWindow } = require("electron");
	const assert = require("node:assert/strict");
	const fs = require("node:fs/promises");
	const path = require("node:path");
	app.setPath("userData", path.join(root, "profile"));
	app.commandLine.appendSwitch("site-per-process");
	app.disableHardwareAcceleration();
	app.whenReady()
		.then(async () => {
			const win = new BrowserWindow({
				show: true,
				width: 800,
				height: 650,
				webPreferences: { sandbox: true, backgroundThrottling: false },
			});
			win.webContents.on("console-message", (event) => {
				if (event.level >= 2) console.error("renderer:", event.message);
			});
			const evaluate = (expression) => win.webContents.executeJavaScript(expression);
			async function until(expression) {
				const deadline = Date.now() + 15000;
				while (Date.now() < deadline) {
					if (await evaluate(expression)) return;
					await new Promise((resolve) => setTimeout(resolve, 30));
				}
				console.error(
					"child-state",
					await win.webContents.mainFrame.frames[0]?.executeJavaScript(
						"JSON.stringify({url:location.href,body:document.body.innerHTML.slice(0,1800)})",
					),
				);
				console.error(
					"probe-state",
					await evaluate(
						"JSON.stringify({probe:window.canvasProbe, state:window.canvasProbe?.read?.(), iframe:document.querySelector('iframe')?.outerHTML})",
					),
				);
				throw Error(`Condition timed out: ${expression}`);
			}
			await win.loadFile(path.join(root, "out/index.html"), { query: { port: String(port) } });
			await until(
				"window.canvasProbe?.read?.().paintTick>0 && window.canvasProbe.read().raster && getComputedStyle(document.querySelector('img')).opacity==='0'",
			);
			const child = win.webContents.mainFrame.frames[0];
			assert.ok(child);
			assert.notEqual(
				child.processId,
				win.webContents.mainFrame.processId,
				"must exercise an out-of-process iframe",
			);
			assert.equal(
				await child.executeJavaScript("!!document.querySelector('[data-test-layout] [data-test-frame]')"),
				true,
			);
			win.focus();
			win.webContents.focus();
			await child.executeJavaScript(
				"window.nativeWheels=0;document.addEventListener('wheel',()=>window.nativeWheels++,true)",
			);
			const ready = await evaluate("canvasProbe.ready");
			win.webContents.debugger.attach("1.3");
			const results = [];
			for (const zoom of [false, true]) {
				const before = await evaluate("({count:canvasProbe.wheels.length,...canvasProbe.read()})");
				const point = await evaluate(
					"(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()",
				);
				console.log(
					"hit",
					await evaluate(
						"JSON.stringify({hit:document.elementFromPoint(" +
							point.x +
							"," +
							point.y +
							")?.outerHTML?.slice(0,220),point:" +
							JSON.stringify(point) +
							"})",
					),
				);
				await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
				await child.executeJavaScript(
					"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
				);
				for (let i = 0; i < 20; i++) {
					await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
						type: "mouseWheel",
						...point,
						deltaY: zoom ? 2 : -2,
						deltaX: 0,
						modifiers: zoom ? 2 : 0,
					});
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
				await until("!canvasProbe.read().parked");
				const after = await evaluate("({count:canvasProbe.wheels.length,...canvasProbe.read()})");
				console.log("native-wheels", await child.executeJavaScript("window.nativeWheels"));
				assert.ok(after.count - before.count >= 18, JSON.stringify({ zoom, before, after }));
				assert.ok(zoom ? after.zoom !== before.zoom : after.y !== before.y, "gesture must move viewport");
				assert.equal(await evaluate("getComputedStyle(document.querySelector('iframe')).display"), "block");
				assert.equal(await evaluate("getComputedStyle(document.querySelector('iframe')).opacity"), "1");
				results.push({ zoom, received: after.count - before.count });
			}
			assert.ok(
				await evaluate("canvasProbe.states.some(s=>s.interacting && s.parked)"),
				"must actually park the live iframe",
			);
			console.log("SAVE_LAYOUT");
			await new Promise((resolve) => setTimeout(resolve, 1800));
			assert.equal(await evaluate("canvasProbe.ready"), ready, "layout save must not reload frame");
			console.log("EDIT_FRAME");
			const deadline = Date.now() + 15000;
			let padding;
			do {
				padding = await child.executeJavaScript(
					"getComputedStyle(document.querySelector('[data-test-frame]')).paddingTop",
				);
				if (padding === "32px") break;
				await new Promise((resolve) => setTimeout(resolve, 30));
			} while (Date.now() < deadline);
			assert.equal(padding, "32px", "source edits must still update Tailwind utilities");
			assert.deepEqual(await evaluate("canvasProbe.errors"), []);
			if (artifacts)
				await fs.writeFile(
					path.join(artifacts, "result.json"),
					JSON.stringify(
						{ isolatedProcesses: true, gestures: results, layoutReloads: 0, sourceHmr: true },
						null,
						2,
					),
				);
			console.log("CANVAS_GESTURES_RESULT", JSON.stringify(results));
			win.destroy();
			app.quit();
		})
		.catch((error) => {
			console.error(error);
			app.exit(1);
		});
}
