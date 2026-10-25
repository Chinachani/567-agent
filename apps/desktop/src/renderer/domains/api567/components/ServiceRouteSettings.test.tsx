// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import { Provider } from "jotai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api567Status } from "@preload/api-types/567api.js";
import { API567_FALLBACK_ROUTES, type Api567RouteCatalog, type Api567RouteId, type Api567RouteProbe } from "../../../../shared/service-routes.js";
import { ServiceRouteSettings } from "./ServiceRouteSettings";

let status: Api567Status;
let listeners: ((s: Api567Status) => void)[];
let resolveSelection: (r: Api567RouteProbe) => void;
let catalog: Api567RouteCatalog;
const api={
 refreshServiceRoutes: vi.fn(async()=>catalog),
 getStatus: vi.fn(async()=>status),
 onStatusChanged: (fn:(s:Api567Status)=>void)=>{listeners.push(fn);return ()=>{listeners=listeners.filter(x=>x!==fn);};},
 probeServiceRoute: vi.fn(async()=>({route:"mainland",ok:true,elapsedMs:12})),
 selectServiceRoute: vi.fn((_route: Api567RouteId, _id: string)=>new Promise<Api567RouteProbe>(r=>{resolveSelection=r;})),
 cancelServiceRouteRequest: vi.fn(async()=>{}),
};
beforeAll(async()=>{
 initI18n();await i18n.changeLanguage("zh");
 // jsdom lacks the browser pointer/scroll APIs used by the real Select.
 HTMLElement.prototype.hasPointerCapture = () => false;
 HTMLElement.prototype.setPointerCapture = () => {};
 HTMLElement.prototype.releasePointerCapture = () => {};
 HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(()=>{ status={isLoggedIn:false,serviceRoute:"germany"};catalog={routes:API567_FALLBACK_ROUTES,source:"cache"};listeners=[];vi.clearAllMocks();Object.assign(window,{agent567:{api567:api}}); });
afterEach(cleanup);

describe("service route selection UI",()=>{
 it("automatically displays discovered nodes and preserves cached choices after refresh failure",async()=>{
  catalog={routes:[...API567_FALLBACK_ROUTES,{id:"https://node3.567.wiki",origin:"https://node3.567.wiki",name:"线路三",description:"独立节点"}],source:"live"};
  const user=userEvent.setup();render(<Provider><ServiceRouteSettings/></Provider>);
  const choose=await screen.findByRole("combobox");
  await waitFor(()=>expect(api.refreshServiceRoutes).toHaveBeenCalled());
  await user.click(choose);expect(await screen.findByRole("option",{name:/线路三/})).toBeTruthy();
  await user.keyboard("{Escape}");
  api.refreshServiceRoutes.mockResolvedValueOnce({...catalog,source:"cache",refreshFailed:true});
  await user.click(screen.getByRole("button",{name:"刷新线路列表"}));
  expect(await screen.findByText(/暂未获取到最新列表/)).toBeTruthy();
  expect(choose.textContent).toContain("德国");
  await user.click(choose);await user.click(await screen.findByRole("option",{name:/线路三/}));
  await act(async()=>{status={...status,serviceRoute:"https://node3.567.wiki"};resolveSelection({route:"https://node3.567.wiki",ok:true});});
  expect(choose.textContent).toContain("线路三");
 });
 it("shows a failed validation, preserves the selected route, and lets the user retry successfully",async()=>{
  const user=userEvent.setup();render(<Provider><ServiceRouteSettings/></Provider>);
  const choose=await screen.findByRole("combobox",{name:"选择服务线路"});
  await waitFor(()=>expect(choose.textContent).toContain("德国"));
  await user.click(choose); await user.click(await screen.findByRole("option",{name:/大陆/})); expect(screen.getByText("正在检测并验证线路…")).toBeTruthy();
  await act(async()=>{resolveSelection({route:"mainland",ok:false,error:"account-rejected"});});
  expect(screen.getByText("账号验证失败，原登录已保留")).toBeTruthy();
  expect(screen.getByRole("combobox").textContent).toContain("德国");
  await user.click(choose); await user.click(await screen.findByRole("option",{name:/大陆/}));
  await act(async()=>{status={...status,serviceRoute:"mainland"};listeners.forEach(fn=>fn(status));resolveSelection({route:"mainland",ok:true,elapsedMs:12});});
  expect(choose.textContent).toContain("大陆");
  expect(screen.getByText(/当前任务继续使用原线路/)).toBeTruthy();
  expect(api.selectServiceRoute).toHaveBeenCalledTimes(2);
 });
 it("lets the user repair an unreadable route instead of disabling every control",async()=>{
  status={isLoggedIn:false,serviceRouteError:true};
  const user=userEvent.setup();render(<Provider><ServiceRouteSettings/></Provider>);
  expect(await screen.findByRole("alert")).toBeTruthy();
  const choose=screen.getByRole("combobox");expect((choose as HTMLButtonElement).disabled).toBe(false);
  await user.click(choose);await user.click(await screen.findByRole("option",{name:/德国/}));
  await act(async()=>{status={isLoggedIn:false,serviceRoute:"germany"};resolveSelection({route:"germany",ok:true});});
  expect(screen.queryByRole("alert")).toBeNull();expect(choose.textContent).toContain("德国");
 });
 it("checks connectivity without switching or resubmitting a model request",async()=>{
  const user=userEvent.setup();render(<Provider><ServiceRouteSettings/></Provider>);
  const check=await screen.findByRole("button",{name:"检测德国线路"});
  await waitFor(()=>expect((check as HTMLButtonElement).disabled).toBe(false));await user.click(check);
  expect(await screen.findByText("可连接 · 12 ms")).toBeTruthy();
  expect(api.selectServiceRoute).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox").textContent).toContain("德国");
 });
 it("cancels an outstanding check when its surface closes",async()=>{
  const user=userEvent.setup();const view=render(<Provider><ServiceRouteSettings/></Provider>);
  const choose=await screen.findByRole("combobox");await waitFor(()=>expect((choose as HTMLButtonElement).disabled).toBe(false));await user.click(choose);await user.click(await screen.findByRole("option",{name:/大陆/}));
  const requestId=api.selectServiceRoute.mock.calls[0]?.[1];view.unmount();
  expect(api.cancelServiceRouteRequest).toHaveBeenCalledWith(requestId);
  await act(async()=>{resolveSelection({route:"mainland",ok:false,error:"unreachable"});});
 });
});
