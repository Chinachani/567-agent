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

// Render the complete sidebar footer, list edge, host page header and production CSS.
// Account data, page context and OS commands are isolated from the user profile.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "agent567-sidebar-layout-"));
const artifactDirectory = process.env.AGENT567_LAYOUT_ARTIFACT_DIR;
let display;
try {
	if (artifactDirectory) await mkdir(artifactDirectory, { recursive: true });
	await symlink(join(desktop, "node_modules"), join(root, "node_modules"), "dir");
	await writeFile(join(root, "index.html"), '<div id="providers" style="display:none"></div><div id="account"></div><div id="header"></div><div id="settings" style="display:none"></div><script type="module" src="/entry.tsx"></script>');
	await writeFile(join(root, "fixture.css"), `@import ${JSON.stringify(join(desktop, "src/renderer/styles.css"))};\n` + [
		"src/renderer/domains/api567/components/Api567AccountDialog.tsx",
		"src/renderer/domains/project/components/sidebar/SidebarBottomBar.tsx",
		"src/renderer/domains/project/components/sidebar/SidebarAccountMenu.tsx",
        "src/renderer/domains/project/components/sidebar/settings-menu/useSettingsMenuModel.ts",
        "src/renderer/domains/project/components/sidebar/settings-menu/SettingsMenuDialog.tsx",
        "src/renderer/domains/settings/components/SettingsListSearch.tsx",
        "src/renderer/domains/settings/components/ModelsProviderRow.tsx",
        "src/renderer/domains/settings/components/ModelContextSettings.tsx",
		"src/renderer/domains/settings/components/GeneralSettings.tsx",
		"src/renderer/domains/settings/components/SessionMigrationSettings.tsx",
		"src/renderer/domains/setup-wizard/components/FeatureGuide.tsx",
	].map(path => `@source ${JSON.stringify(join(desktop, path))};`).join("\n"));
	await writeFile(join(root, "entry.tsx"), `
import {createRoot} from "react-dom/client";
import {useState} from "react";
import i18n from "i18next";
import {initReactI18next} from "react-i18next";
import settings from ${JSON.stringify(join(desktop, "src/shared/i18n/locales/zh/settings.json"))};
import common from ${JSON.stringify(join(desktop, "src/shared/i18n/locales/zh/common.json"))};
import message from ${JSON.stringify(join(desktop, "src/shared/i18n/locales/zh/message.json"))};
import project from ${JSON.stringify(join(desktop, "src/shared/i18n/locales/zh/project.json"))};
import {ThemeHostProvider} from "@vetta-org/theme-sdk";
import "./fixture.css";
import {SidebarBottomBar} from ${JSON.stringify(join(desktop, "src/renderer/domains/project/components/sidebar/SidebarBottomBar.tsx"))};
import {ProjectsPanelView,DefaultSessionRowView} from "@vetta-org/theme-ui/project";
import {PageHeader} from ${JSON.stringify(join(desktop, "src/renderer/shared/app-shell/page-header/PageHeader.tsx"))};
import {useWindowControlsModel} from ${JSON.stringify(join(desktop, "src/renderer/shared/app-shell/window-controls/useWindowControlsModel.ts"))};
import {ModelContextSettings} from ${JSON.stringify(join(desktop, "src/renderer/domains/settings/components/ModelContextSettings.tsx"))};
import {ModelsProvidersSection} from ${JSON.stringify(join(desktop, "src/renderer/domains/settings/components/ModelsProvidersSection.tsx"))};
import {useModelsSettingsModel} from ${JSON.stringify(join(desktop, "src/renderer/domains/settings/components/useModelsSettingsModel.ts"))};
import {GeneralSettings} from ${JSON.stringify(join(desktop, "src/renderer/domains/settings/components/GeneralSettings.tsx"))};
import {applyTheme} from ${JSON.stringify(join(desktop, "src/renderer/shared/theme/apply.ts"))};
await i18n.use(initReactI18next).init({lng:"zh",resources:{zh:{settings,common,message,project}}});
window.applyLayoutTheme=mode=>applyTheme(mode,"mono");window.applyLayoutTheme("dark");
let maximized=false;
window.layoutCommands=[];
window.agent567={window:{
  minimize:async()=>{window.layoutCommands.push("minimize")},
  maximize:async()=>{maximized=!maximized;window.layoutCommands.push(maximized?"maximize":"restore")},
  close:async()=>{window.layoutCommands.push("close")},
  isMaximized:async()=>maximized,onMaximizedChanged:()=>()=>{}
},im:{subscribeStatus:async()=>()=>{},getStatus:async()=>({transport:"online"})},updater:{sync:async()=>{}},subscription:{getStatus:async()=>({})},models:{onChanged:()=>()=>{},setContextWindow:async()=>{},get:async()=>({providers:{"自定义服务商":{baseUrl:"https://models.example.test/long-provider-path/openai/v1",models:[{id:"vision-pro",input:["text","image"]}]},"本地模型":{baseUrl:"http://localhost:11434/v1",models:[{id:"local-model"}]}}}),fetchRemote:async()=>({providers:{}}),set:async()=>{}},config:{get:async()=>({notificationsEnabled:true}),set:async()=>{}},appMonitor:{recordEvent:()=>{}}};
const host={appShell:{useWindowControlsModel,usePageHeaderModel:()=>({
  title:"用于验证窄窗口标题栏的较长会话名称", titleBadge:"较长的项目和工作区名称",triggerVisible:true,
  sidebarTriggerTitle:"展开侧栏",rightSlot:<><button className="no-drag h-7 w-7 shrink-0" title="固定">⌖</button><button className="no-drag h-7 w-7 shrink-0" title="面板">◫</button></>
})}};
function SidebarFooterFixture(){
  const [scrollElement,setScrollElement]=useState(null);
  const labels=["日常工作任务咨询与协助","FAF 上下文 MCP 评估","确认是否需要继续回复","OpenCode Go控制台","Geo-sleuth 项目解答","项目进度与后续安排"];
  return <div className="flex h-[230px] min-w-0 flex-col overflow-hidden bg-muted">
    <ProjectsPanelView defaultSection={labels.map((label,index)=><DefaultSessionRowView key={label} label={label} active={index===3} contextMenuEnabled={true} moreLabel="更多" onOpenContextMenu={()=>{}} onRename={()=>{}} onRenameDone={()=>{}} onSelect={()=>{}} renaming={false} running={false} scheduled={false}/>)} emptyState={null} menus={null} onScrollRef={setScrollElement} scrollElement={scrollElement} projectsSection={null} quickScrollLabels={{top:"回到顶部",bottom:"去底部"}} showDefaultRegion={true} showEmpty={false} showProjectsRegion={false}/>
    <SidebarBottomBar/>
  </div>;
}
const accountRoot=createRoot(document.getElementById("account")!);
window.renderLayoutAccount=account=>{window.layoutAccount=account;accountRoot.render(<SidebarFooterFixture/>)};
window.renderLayoutAccount();
createRoot(document.getElementById("header")!).render(<ThemeHostProvider host={host}><PageHeader narrow={false} sidebarCollapsed={true} onExpandSidebar={()=>{}} onOverlayOpen={()=>{}} onOverlayClose={()=>{}}/></ThemeHostProvider>);
createRoot(document.getElementById("settings")!).render(<GeneralSettings/>);
function ProvidersFixture(){const model=useModelsSettingsModel();return <div className="p-4"><ModelsProvidersSection model={model}/>{model.config&&<ModelContextSettings config={model.config}/>}</div>}
createRoot(document.getElementById("providers")!).render(<ProvidersFixture/>);
`);
	await build({
		configFile: false, root, base: "./", logLevel: "warn", esbuild: { jsx: "automatic" },
		resolve: { alias: { "@": join(desktop, "src"), "@shared": join(desktop, "src/renderer/shared"), "@preload": join(desktop, "src/preload"), "@domains": join(desktop, "src/renderer/domains"), "@cloud": join(desktop,"src/renderer/cloud") } },
		plugins: [tailwindcss(), {
			name: "isolated-account-boundary", enforce: "pre",
			resolveId(source, importer) {
                if (source === "@tanstack/react-router" && (importer?.endsWith("/SidebarAccountMenu.tsx") || importer?.endsWith("/useSettingsMenuModel.ts"))) return "\0fixture-router";
                if (importer?.endsWith("/api567/index.ts") && source === "./hooks/useApi567") return "\0account-state";
                if (!importer?.endsWith("/Api567AccountDialog.tsx")) return;
                if (source === "../hooks/useApi567") return "\0account-state";
                if (source === "./ServiceRouteSettings") return "\0account-route";
			},
			load(id) {
                if (id === "\0fixture-router") return "export const useNavigate=()=>()=>{}";
				if (id === "\0account-route") return "export const ServiceRouteSettings = () => null";
				if (id === "\0account-state") return `export const useApi567 = () => ({status:{isLoggedIn:true,username:"用于窄侧栏验证的较长昵称",loginUsername:"夜雨寄北",activeGroup:"用于验证的较长模型分组名称",quotaUsd:21.41,...window.layoutAccount},availableGroups:{},groupsLoadState:{loading:false,error:false,loaded:true},loadAvailableGroups:async()=>{}})`;
			},
		}],
		build: { outDir: join(root, "out"), target: "esnext" },
	});
	const inspect = `(async()=>{
    const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await paint(); const host=document.getElementById("account"); const rows=[];
    for (const mode of ["dark","light"]) for(const width of [180,220,280,340]) {
      window.applyLayoutTheme(mode); host.style.width=width+"px"; await paint();
      const button=host.querySelector('button[aria-label^="打开"]'); const balance=button.querySelector('[title^="余额"]');
      if(!balance) throw Error("Missing balance");
      const hit=element=>{const r=element.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return element===target||element.contains(target)};
      const scroll=host.querySelector('[data-sidebar-selection-scroll]');
      scroll.scrollTop=scroll.scrollHeight;await paint();
      const last=[...scroll.querySelectorAll("button")].find(button=>button.textContent==="项目进度与后续安排");
      const lastRect=last.getBoundingClientRect(),scrollRect=scroll.getBoundingClientRect();
      rows.push({mode,width,buttonWidth:button.getBoundingClientRect().width,
        hostOverflow:host.scrollWidth-host.clientWidth,buttonOverflow:button.scrollWidth-button.clientWidth,
        balanceOverflow:balance.scrollWidth-balance.clientWidth,
        balancePastButton:balance.getBoundingClientRect().right-button.getBoundingClientRect().right,
        balance:balance.textContent,triggerHit:hit(button),
        listBottom:scrollRect.bottom,lastRowVisible:lastRect.top>=scrollRect.top&&lastRect.bottom<=scrollRect.bottom,lastRowHit:hit(last),
        accountTop:button.getBoundingClientRect().top});
    }
    const trigger=host.querySelector('button[aria-label^="打开"]');trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await paint();
    const themes=[...document.querySelectorAll('[role="menuitemradio"]')];
    if(themes.length!==3||themes.some(item=>{const icon=item.querySelector('[aria-hidden]'),r=item.getBoundingClientRect();return !icon||getComputedStyle(icon).maskImage==="none"||r.width<20||r.height<20}))throw Error("Theme controls or icons are not visible");
    const items=[...document.querySelectorAll('[role="menuitem"]')];
    for(const label of ["账号与模型分组","账户额度充值","消息中心","设置","Claw","退出 567 登录"]) if(!items.some(item=>item.textContent.includes(label))) throw Error("Missing menu entry: "+label);
    items.find(item=>item.textContent.includes("账号与模型分组")).click();await paint();
    if(!document.querySelector('[role="dialog"]')) await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{observer.disconnect();reject(Error("Account details did not open"))},2500);
      const observer=new MutationObserver(()=>{if(document.querySelector('[role="dialog"]')){clearTimeout(timer);observer.disconnect();resolve()}});
      observer.observe(document.body,{childList:true,subtree:true});
    });
    return rows;
  })()`;
	const inspectSettings = `(async()=>{
    const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    document.getElementById("account").style.display="none";
    document.getElementById("header").style.display="none";
    const host=document.getElementById("settings");host.style.display="block";await paint();
    const cards=[...host.querySelectorAll("[data-setting-section-id]")].map(card=>{
      const rect=card.getBoundingClientRect();return {id:card.dataset.settingSectionId,left:rect.left,right:rect.right};
    });
    const guide=[...host.querySelectorAll("button")].find(button=>button.textContent==="打开使用指南");
    if(!guide)throw Error("Missing guide entry");guide.click();await paint();
    const dialog=document.querySelector('[role="dialog"]');if(!dialog)throw Error("Missing guide dialog");
    await Promise.all(dialog.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));await paint();
    const body=dialog.querySelector('[data-guide-body]');
    const close=dialog.querySelector('button[aria-label="关闭"]');
    const header=dialog.querySelector('[data-slot="dialog-header"]');
    const rect=dialog.getBoundingClientRect();const headerTop=header.getBoundingClientRect().top;
    const firstTask=body.querySelector("button").getBoundingClientRect(),bodyRect=body.getBoundingClientRect();
    body.scrollTop=body.scrollHeight;await paint();
    const buttonRect=close.getBoundingClientRect();const hit=document.elementFromPoint(buttonRect.x+buttonRect.width/2,buttonRect.y+buttonRect.height/2);
    const result={width:innerWidth,cards,pageOverflow:host.scrollWidth-host.clientWidth,
      dialogLeft:rect.left,dialogRight:rect.right,dialogTop:rect.top,dialogBottom:rect.bottom,
      bodyOverflow:body.scrollWidth-body.clientWidth,bodyHeight:body.clientHeight,
      headerShift:header.getBoundingClientRect().top-headerTop,closeHit:close===hit||close.contains(hit),
      firstTaskVisible:firstTask.top>=bodyRect.top&&firstTask.bottom<=bodyRect.bottom};
    const topic=[...body.querySelectorAll("button")].find(button=>button.textContent.trim()==="手机协作与远程控制");
    topic.click();await paint();
    result.articleFocused=document.activeElement===body.querySelector("h3");
    result.steps=body.querySelectorAll("li").length;
    return result;
  })()`;
	const inspectHeader = `(async()=>{
    const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const account=document.getElementById("account"); account.style.display="none";
    const host=document.getElementById("header"); const rows=[];
    for(const mode of ["dark","light"]) for(const width of [260,380,640,1024]) {
      window.applyLayoutTheme(mode); host.style.width=width+"px"; await paint();
      if(host.textContent.includes("$21.41")) throw Error("Duplicate account in title bar");
      const controls=["最小化","最大化","关闭"].map(label=>{
        const button=host.querySelector('button[aria-label="'+label+'"]');
        if(!button) throw Error("Missing window control: "+label);
        const rect=button.getBoundingClientRect();
        let drag="none";
        for(let node=button;node;node=node.parentElement) {
          drag=getComputedStyle(node).getPropertyValue("-webkit-app-region");
          if(drag!=="none") break;
        }
        const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        return {label,x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,
          drag,hit:button===hit||button.contains(hit)};
      });
      rows.push({mode,width,overflow:host.scrollWidth-host.clientWidth,controls});
    }
    host.style.width="260px"; await paint();
    return rows;
  })()`;
	const overviewForScreenshot = `(async()=>{
    [...document.querySelectorAll('[data-guide-body] button')].find(button=>button.textContent.trim()==="返回目录").click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    document.querySelector('[data-guide-body]').scrollTop=0;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  })()`;
	const settingsForScreenshot = `(async()=>{
    const dialog=document.querySelector('[role="dialog"]');
    const removed=new Promise(resolve=>{
      const observer=new MutationObserver(()=>{if(!dialog.isConnected){observer.disconnect();resolve()}});
      observer.observe(document.body,{childList:true,subtree:true});
    });
    dialog.querySelector('button[aria-label="关闭"]').click();
    await removed;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    document.getElementById("general-help").scrollIntoView({block:"start"});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  })()`;
	const menuForScreenshot = `(async()=>{const host=document.getElementById("account");host.style.width="280px";window.renderLayoutAccount({username:"夜雨寄北",loginUsername:"Yeyu",quotaUsd:62.53});document.getElementById("header").style.display="none";await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));host.firstElementChild.style.height="560px";const b=host.querySelector('button[aria-label^="打开"]');b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`;
    const inspectProviders = `(async()=>{
        for(const id of ["account","header","settings"])document.getElementById(id).style.display="none";
        const host=document.getElementById("providers");host.style.display="block";
        const search=()=>host.querySelector('input[aria-label="查找模型"]');
        if(!search())await new Promise((resolve,reject)=>{
            const observer=new MutationObserver(()=>{if(search()){clearTimeout(timer);observer.disconnect();resolve()}});
            const timer=setTimeout(()=>{observer.disconnect();reject(Error("Missing context search"))},2500);
            observer.observe(host,{childList:true,subtree:true});
        });
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return {overflow:host.scrollWidth-host.clientWidth,searchVisible:!!search(),buttons:[...host.querySelectorAll("button,input")].map(b=>b.getBoundingClientRect().right).filter(r=>r>innerWidth+1).length};
    })()`;

	const runner = join(root, "runner.cjs");
	await writeFile(runner, `
const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(root, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:true,frame:false,width:1100,height:400,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  await win.loadFile(${JSON.stringify(join(root, "out/index.html"))});
  const result=await win.webContents.executeJavaScript(${JSON.stringify(inspect)});
  console.log("SIDEBAR_LAYOUT_RESULT "+JSON.stringify(result));
  if(${JSON.stringify(artifactDirectory ?? null)}) {
    const fs=require("node:fs/promises"),path=require("node:path");
    for(const mode of ["dark","light"])for(const width of [180,220,280]) {
      await win.loadFile(${JSON.stringify(join(root, "out/index.html"))});
      await win.webContents.executeJavaScript('(async()=>{window.renderLayoutAccount({username:"夜雨寄北",loginUsername:"Yeyu",activeGroup:"反重力Gemini",quotaUsd:62.53});window.applyLayoutTheme('+JSON.stringify(mode)+');const host=document.getElementById("account");host.style.width='+width+'+"px";document.getElementById("header").style.display="none";await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
      await fs.writeFile(path.join(${JSON.stringify(artifactDirectory ?? "")},"sidebar-"+mode+"-"+width+".png"),(await win.capturePage({x:0,y:0,width,height:230})).toPNG());
    }
  }
  if(${JSON.stringify(artifactDirectory ?? null)}) {
    win.setContentSize(680,600);await win.loadFile(${JSON.stringify(join(root, "out/index.html"))});
    await win.webContents.executeJavaScript(${JSON.stringify(menuForScreenshot)});
    const fs=require("node:fs/promises"),path=require("node:path");await fs.writeFile(path.join(${JSON.stringify(artifactDirectory ?? "")},"account-menu.png"),(await win.capturePage({x:0,y:0,width:300,height:570})).toPNG());
  }
  win.setContentSize(1100,400);
  await win.loadFile(${JSON.stringify(join(root, "out/index.html"))});
  const header=await win.webContents.executeJavaScript(${JSON.stringify(inspectHeader)});
  console.log("TITLEBAR_LAYOUT_RESULT "+JSON.stringify(header));
  const locateControl=${JSON.stringify('async label=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const button=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")===label);if(!button)throw Error("Missing control: "+label);const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}')};
  for(const label of ["最小化","最大化","还原","关闭"]) {
    const point=await win.webContents.executeJavaScript("("+locateControl+")("+JSON.stringify(label)+")");
    win.webContents.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...point});
    win.webContents.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...point});
  }
  const commands=await win.webContents.executeJavaScript('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return window.layoutCommands})()');
  console.log("TITLEBAR_COMMANDS "+JSON.stringify(commands));
  const settings=[];const providers=[];
  for(const mode of ["dark","light"])for(const width of [380,680,1000]) {
    win.setContentSize(width,540);
    await win.loadFile(${JSON.stringify(join(root, "out/index.html"))});
    await win.webContents.executeJavaScript('window.applyLayoutTheme('+JSON.stringify(mode)+')');
    const provider=await win.webContents.executeJavaScript(${JSON.stringify(inspectProviders)});providers.push({mode,width,...provider});
    if(${JSON.stringify(artifactDirectory ?? null)}) {const fs=require("node:fs/promises"),path=require("node:path");await fs.writeFile(path.join(${JSON.stringify(artifactDirectory ?? "")},"providers-"+mode+"-"+width+".png"),(await win.capturePage()).toPNG());}
    await win.webContents.executeJavaScript('document.getElementById("providers").style.display="none"');
    settings.push({mode,...await win.webContents.executeJavaScript(${JSON.stringify(inspectSettings)})});
    if(${JSON.stringify(artifactDirectory ?? null)}) {
      const fs=require("node:fs/promises"),path=require("node:path");
      await win.webContents.executeJavaScript(${JSON.stringify(overviewForScreenshot)});
      await fs.writeFile(path.join(${JSON.stringify(artifactDirectory ?? "")},"guide-"+mode+"-"+width+".png"),(await win.capturePage()).toPNG());
      await win.webContents.executeJavaScript(${JSON.stringify(settingsForScreenshot)});
      await fs.writeFile(path.join(${JSON.stringify(artifactDirectory ?? "")},"settings-"+mode+"-"+width+".png"),(await win.capturePage()).toPNG());
    }
  }
  console.log("SETTINGS_GUIDE_RESULT "+JSON.stringify(settings));console.log("PROVIDERS_LAYOUT_RESULT "+JSON.stringify(providers));
  win.destroy(); app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
	display = spawn(process.env.AGENT567_TEST_XVFB ?? "Xvfb", ["-displayfd", "1", "-screen", "0", "1600x900x24", "-nolisten", "tcp"], { stdio: ["ignore", "pipe", "pipe"] });
	const displayReady = await Promise.race([
		once(display.stdout, "data"),
		once(display, "error").then(([error]) => { throw error; }),
	]);
	const displayNumber = displayReady[0].toString().trim();
	const env = { ...process.env, DISPLAY: `:${displayNumber}` };
	delete env.ELECTRON_RUN_AS_NODE;
	const binary = process.env.AGENT567_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
	const child = spawn(binary, ["--no-sandbox", runner], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
	let output = "";
	child.stdout.on("data", chunk => { output += chunk; });
	child.stderr.on("data", chunk => { output += chunk; });
	const [code, signal] = await once(child, "exit");
	assert.equal(code, 0, `Account layout probe exited ${code}/${signal}: ${output}`);
	const match = output.match(/SIDEBAR_LAYOUT_RESULT (\[[^\n]+\])/);
	assert.ok(match, output);
	const rows = JSON.parse(match[1]);
	assert.equal(rows.length, 8);
	for (const row of rows) {
		assert.equal(row.balance, "余额 $21.41");
		assert.equal(row.triggerHit, true, JSON.stringify(row));
		assert.equal(row.lastRowVisible, true, JSON.stringify(row));
		assert.equal(row.lastRowHit, true, JSON.stringify(row));
		assert.ok(row.listBottom <= row.accountTop, JSON.stringify(row));
		assert.ok(row.buttonWidth <= row.width + 1, JSON.stringify(row));
		for (const field of ["hostOverflow", "buttonOverflow", "balanceOverflow", "balancePastButton"]) {
			assert.ok(row[field] <= 1, JSON.stringify(row));
		}
	}
	console.log("SIDEBAR_ACCOUNT_LAYOUT_PASSED", JSON.stringify(rows));
	const headerMatch = output.match(/TITLEBAR_LAYOUT_RESULT (\[[^\n]+\])/);
	assert.ok(headerMatch, output);
	const headerRows = JSON.parse(headerMatch[1]);
	assert.equal(headerRows.length, 8);
	for (const row of headerRows) {
		assert.ok(row.overflow <= 1, JSON.stringify(row));
		for (const control of row.controls) {
			assert.ok(control.width >= 43 && control.height >= 31, JSON.stringify(row));
			assert.ok(control.x >= 0 && control.right <= row.width + 1, JSON.stringify(row));
			assert.equal(control.drag, "no-drag", JSON.stringify(row));
			assert.equal(control.hit, true, JSON.stringify(row));
		}
	}
	const commands = output.match(/TITLEBAR_COMMANDS (\[[^\n]+\])/);
	assert.ok(commands, output);
	assert.deepEqual(JSON.parse(commands[1]), ["minimize", "maximize", "restore", "close"]);
	console.log("TITLEBAR_LAYOUT_PASSED", JSON.stringify(headerRows));
	const settingsMatch = output.match(/SETTINGS_GUIDE_RESULT (\[[^\n]+\])/);
	assert.ok(settingsMatch, output);
	const settingsRows = JSON.parse(settingsMatch[1]);
	assert.equal(settingsRows.length, 6);
	for (const row of settingsRows) {
		assert.equal(row.cards.length, 5, JSON.stringify(row));
		for (const card of row.cards) {
			assert.ok(Math.abs(card.left - row.cards[0].left) <= 1, JSON.stringify(row));
			assert.ok(Math.abs(card.right - row.cards[0].right) <= 1, JSON.stringify(row));
		}
		assert.ok(row.pageOverflow <= 1 && row.bodyOverflow <= 1, JSON.stringify(row));
		assert.ok(row.dialogLeft >= 0 && row.dialogRight <= row.width + 1, JSON.stringify(row));
		assert.ok(row.dialogTop >= 0 && row.dialogBottom <= 541 && row.bodyHeight > 0, JSON.stringify(row));
		assert.equal(row.headerShift, 0, JSON.stringify(row));
		assert.equal(row.closeHit, true, JSON.stringify(row));
		assert.equal(row.firstTaskVisible, true, JSON.stringify(row));
		assert.equal(row.articleFocused, true, JSON.stringify(row));
		assert.equal(row.steps, 3, JSON.stringify(row));
	}
	console.log("SETTINGS_GUIDE_LAYOUT_PASSED", JSON.stringify(settingsRows));
    const providersMatch=output.match(/PROVIDERS_LAYOUT_RESULT (\[[^\n]+\])/);assert.ok(providersMatch,output);
    const providerRows=JSON.parse(providersMatch[1]);assert.equal(providerRows.length,6);
    for(const row of providerRows){assert.equal(row.searchVisible,true,JSON.stringify(row));assert.ok(row.overflow<=1,JSON.stringify(row));assert.equal(row.buttons,0,JSON.stringify(row));}
    console.log("PROVIDERS_LAYOUT_PASSED",JSON.stringify(providerRows));
} finally {
	if (display?.pid && display.exitCode === null && display.signalCode === null) { const closed = once(display, "exit"); display.kill(); await closed; }
	await rm(root, { recursive: true, force: true });
}
