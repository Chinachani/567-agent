import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dbus from "dbus-next";

// A private bus and display ensure this regression never captures the user's desktop.
const binary = process.env.AGENT567_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
const xvfbBinary = process.env.AGENT567_TEST_XVFB ?? "Xvfb";
if (!binary) throw new Error("Set AGENT567_TEST_ELECTRON to the standalone Electron binary");
const root = await mkdtemp(join(tmpdir(), "agent567-portal-"));
const children = [];
let bus;
try {
	const daemon = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], { stdio: ["ignore", "pipe", "pipe"] });
	children.push(daemon);
	const address = (await once(daemon.stdout, "data"))[0].toString().trim();
	const displayFile = join(root, "display");
	// -displayfd lets Xvfb choose an unused display instead of touching a real session.
	const xvfb = spawn(xvfbBinary, ["-displayfd", "1", "-screen", "0", "1280x720x24", "-nolisten", "tcp", "-ac"], { stdio: ["ignore", "pipe", "pipe"] });
	children.push(xvfb);
	xvfb.on("error", (error) => { throw error; });
	const display = (await once(xvfb.stdout, "data"))[0].toString().trim();
	await writeFile(displayFile, display);
	bus = dbus.sessionBus({ busAddress: address });
	await bus.requestName("org.freedesktop.portal.Desktop", 0);
	class Request extends dbus.interface.Interface {
		constructor() { super("org.freedesktop.portal.Request"); }
		Response(code, results) { return [code, results]; }
		Close() {}
	}
	Request.configureMembers({ methods: { Close: { inSignature: "", outSignature: "" } }, signals: { Response: { signature: "ua{sv}" } } });
	class Session extends dbus.interface.Interface {
		constructor() { super("org.freedesktop.portal.Session"); }
		Close() {}
	}
	Session.configureMembers({ methods: { Close: { inSignature: "", outSignature: "" } } });
	let cancelled = 0;
	let caller = "test";
	bus.addMethodHandler((message) => {
		console.log("PORTAL_CALL", message.interface, message.member);
		if (message.interface === "org.freedesktop.portal.ScreenCast") caller = message.sender.slice(1).replaceAll(".", "_");
		return false;
	});
	function respond(options, code, results = {}) {
		const path = `/org/freedesktop/portal/desktop/request/${caller}/${options.handle_token.value}`;
		const request = new Request();
		bus.export(path, request);
		const receiver = `:${caller.replaceAll("_", ".")}`;
		setTimeout(() => {
			const message = dbus.Message.newSignal(path, "org.freedesktop.portal.Request", "Response", "ua{sv}", [code, results]);
			message.destination = receiver;
			bus.send(message);
		}, 20);
		return path;
	}
	class ScreenCast extends dbus.interface.Interface {
		constructor() { super("org.freedesktop.portal.ScreenCast"); }
		get version() { return 4; }
		get AvailableSourceTypes() { return 3; }
		get AvailableCursorModes() { return 7; }
		CreateSession(options) {
			const path = `/org/freedesktop/portal/desktop/session/${caller}/${options.session_handle_token.value}`;
			bus.export(path, new Session());
			return respond(options, 0, { session_handle: new dbus.Variant("s", path) });
		}
		SelectSources(_session, options) { return respond(options, 0); }
		Start(_session, _parent, options) { cancelled += 1; return respond(options, 1); }
	}
	ScreenCast.configureMembers({ properties: {
		version: { signature: "u", access: "read" }, AvailableSourceTypes: { signature: "u", access: "read" }, AvailableCursorModes: { signature: "u", access: "read" },
	}, methods: {
		CreateSession: { inSignature: "a{sv}", outSignature: "o" }, SelectSources: { inSignature: "oa{sv}", outSignature: "o" }, Start: { inSignature: "osa{sv}", outSignature: "o" },
	} });
	bus.export("/org/freedesktop/portal/desktop", new ScreenCast());
	const probePath = join(root, "probe.cjs");
	await writeFile(probePath, `const {app,desktopCapturer,BrowserWindow,session}=require('electron');
app.setPath('userData',process.env.AGENT567_PROBE_PROFILE);
app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('enable-features','WebRTCPipeWireCapturer');
app.whenReady().then(async()=>{
 for(let i=0;i<3;i++){
  try{await desktopCapturer.getSources({types:['screen','window']});throw Error('Cancellation was not propagated');}
  catch(e){if((e.message??String(e))!=='Failed to get sources.')throw e;console.log('CANCELLED',i+1);}
 }
 let denialThrows=0;
 session.defaultSession.setDisplayMediaRequestHandler((_request,callback)=>{try{callback(null)}catch(e){denialThrows++;}});
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await window.loadFile(__filename.replace('probe.cjs','probe.html'));
 for(let i=0;i<3;i++){
  const outcome=await window.webContents.executeJavaScript("navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'granted'},e=>'denied')",true);
  if(outcome!=='denied')throw Error('Denied media request was granted');
 }
 if(denialThrows)throw Error('Native denial callback threw');
 window.destroy();console.log('DENIALS_PASSED',3);
 setTimeout(()=>{console.log('PROBE_PASSED',process.versions.electron);app.exit(0)},200);
}).catch(e=>{console.error(e.message??String(e));app.exit(1)});
setTimeout(()=>app.exit(2),15000).unref();`);
	await writeFile(join(root, "probe.html"), "<!doctype html><title>Isolated capture denial probe</title>");
	const probe = spawn(binary, ["--no-sandbox", "--disable-gpu", "--ozone-platform=x11", probePath], { env: {
		...process.env, ELECTRON_RUN_AS_NODE: "", DISPLAY: `:${display}`, XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "agent567-private-test", DBUS_SESSION_BUS_ADDRESS: address, AGENT567_PROBE_PROFILE: join(root, "profile"),
	}, stdio: ["ignore", "pipe", "pipe"] });
	children.push(probe);
	let output = "";
	probe.stdout.on("data", (chunk) => { output += chunk; });
	probe.stderr.on("data", (chunk) => { output += chunk; });
	const [code, signal] = await once(probe, "exit");
	console.log(JSON.stringify({ code, signal, cancelled, passed: code === 0 && cancelled >= 3 && output.includes("PROBE_PASSED") }));
	console.log(output);
	if (code !== 0 || cancelled < 3 || !output.includes("PROBE_PASSED")) process.exitCode = 1;
} finally {
	bus?.disconnect();
	for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) child.kill();
	await rm(root, { recursive: true, force: true });
}
