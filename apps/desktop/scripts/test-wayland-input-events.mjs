import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dbus from 'dbus-next';
import { build } from 'vite';

// Real DBus serialization, isolated compositor fixture; no real screen, keys or clipboard.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'agent567-input-events-'));
let daemon;
let bus;
let child;
try {
  await symlink(join(desktop, 'node_modules'), join(root, 'node_modules'), 'dir');
  const entry = join(root, 'probe.mjs');
  await writeFile(entry, `import { createWaylandInputAdapter } from ${JSON.stringify(join(desktop, 'src/main/remote-control/wayland-input.ts'))};
const delivered = new Promise(resolve => process.once('message', resolve));
const adapter = createWaylandInputAdapter(undefined, text => { if(text !== '中文 hello 🌟') throw Error('Incorrect paste'); });
try {
 await adapter.setEnabled(true);
 let sequence=0;
 for(const code of ['Escape','Enter','ControlLeft','KeyC']) for(const action of ['down','up']) adapter.apply({type:'key',sequence:++sequence,code,action});
 adapter.apply({type:'text',sequence:++sequence,text:'中文 hello 🌟'});
 adapter.apply({type:'pointer.scroll',sequence:++sequence,deltaX:0,deltaY:24});
 await delivered;
 console.log('INPUT_EVENTS_PASSED');
} finally {adapter.setEnabled(false);}`);
  await build({ configFile: join(desktop, 'vite.main.config.ts'), logLevel: 'warn',
    plugins: [{ name:'isolated-log-boundary', enforce:'pre', resolveId(source, importer) {
      if(source === '../logger.js' && importer?.includes('/remote-control/')) return '\0isolated-logger';
    }, load(id) { if(id === '\0isolated-logger') return 'export const getAppLogger=()=>({info(){},warn(){}})'; } }],
    build: { lib:{entry,formats:['es'],fileName:()=> 'bundled.mjs'},outDir:join(root,'out'),emptyOutDir:true },
  });
  daemon = spawn('dbus-daemon', ['--session','--nofork','--print-address=1'], {stdio:['ignore','pipe','pipe']});
  const address = (await once(daemon.stdout,'data'))[0].toString().trim();
  bus = dbus.sessionBus({busAddress:address});
  await bus.requestName('org.freedesktop.portal.Desktop',0);
  class Request extends dbus.interface.Interface { constructor(){super('org.freedesktop.portal.Request');} Close(){} }
  Request.configureMembers({methods:{Close:{inSignature:'',outSignature:''}}});
  class Session extends dbus.interface.Interface { constructor(){super('org.freedesktop.portal.Session');} Close(){} }
  Session.configureMembers({methods:{Close:{inSignature:'',outSignature:''}}});
  const session = '/org/freedesktop/portal/desktop/session/test/input';
  bus.export(session,new Session());
  const respond = (options,results={}) => {
    const path = `/org/freedesktop/portal/desktop/request/test/${options.handle_token.value}`;
    bus.export(path,new Request());
    setImmediate(()=>bus.send(dbus.Message.newSignal(path,'org.freedesktop.portal.Request','Response','ua{sv}',[0,results])));
    return path;
  };
  const keys=[];
  const axes=[];
  class Portal extends dbus.interface.Interface {
    constructor(){super('org.freedesktop.portal.RemoteDesktop');}
    get version(){return 2;}
    CreateSession(options){return respond(options,{session_handle:new dbus.Variant('o',session)});}
    SelectDevices(_session,options){return respond(options);}
    Start(_session,_parent,options){return respond(options,{devices:new dbus.Variant('u',3)});}
    NotifyKeyboardKeycode(_session,_options,key,state){keys.push([key,state]);}
    NotifyPointerAxis(_session,options,dx,dy){
      axes.push([dx,dy,options.finish?.value??false]);
      if(options.finish?.value) child.send('events-delivered');
    }
  }
  Portal.configureMembers({properties:{version:{signature:'u',access:'read'}},methods:{
    CreateSession:{inSignature:'a{sv}',outSignature:'o'},SelectDevices:{inSignature:'oa{sv}',outSignature:'o'},Start:{inSignature:'osa{sv}',outSignature:'o'},
    NotifyKeyboardKeycode:{inSignature:'oa{sv}iu',outSignature:''},NotifyPointerAxis:{inSignature:'oa{sv}dd',outSignature:''},
  }});
  bus.export('/org/freedesktop/portal/desktop',new Portal());
  child=spawn(process.env.AGENT567_TEST_ELECTRON??process.execPath,[join(root,'out/bundled.mjs')],{
    env:{...process.env,DBUS_SESSION_BUS_ADDRESS:address,...(process.env.AGENT567_TEST_ELECTRON?{ELECTRON_RUN_AS_NODE:'1'}:{})},
    stdio:['ignore','pipe','pipe','ipc'],timeout:15000,
  });
  let output='';
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  const [code,signal]=await once(child,'exit');
  assert.equal(code,0,`${code}/${signal}: ${output}`);
  assert.match(output,/INPUT_EVENTS_PASSED/);
  assert.deepEqual(keys,[[1,1],[1,0],[28,1],[28,0],[29,1],[29,0],[46,1],[46,0],[29,1],[47,1],[47,0],[29,0]]);
  assert.deepEqual(axes,[[0,24,false],[0,0,true]]);
  console.log(JSON.stringify({passed:true,keyboardEvents:keys.length,scrollEvents:axes.length,clipboard:'isolated fixture'}));
} finally {
  if(child?.exitCode===null)child.kill();
  bus?.disconnect();
  if(daemon){const closed=once(daemon,'exit');daemon.kill();await closed;}
  await rm(root,{recursive:true,force:true});
}
