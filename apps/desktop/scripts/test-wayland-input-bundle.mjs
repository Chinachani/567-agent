import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Exercise the production ESM bundler and real DBus connection in a child process.
// The portal is intentionally absent. Formatting that error must not crash Node.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'agent567-input-bundle-'));
let daemon;
try {
  await symlink(join(desktop, 'node_modules'), join(root, 'node_modules'), 'dir');
  const entry = join(root, 'probe.mjs');
  await writeFile(entry, `import { createWaylandInputAdapter } from ${JSON.stringify(join(desktop, 'src/main/remote-control/wayland-input.ts'))};
const original = Error.prepareStackTrace;
const adapter = createWaylandInputAdapter();
try { await adapter.setEnabled(true); throw Error('Unexpected permission grant'); }
catch (error) { if (!String(error.stack).includes('Error')) throw Error('Missing error stack'); }
finally { adapter.setEnabled(false); }
if (Error.prepareStackTrace !== original) throw Error('Dependency corrupted Error.prepareStackTrace');
console.log('WAYLAND_BUNDLE_PASSED');`);
  process.chdir(desktop);
  await build({ configFile: join(desktop, 'vite.main.config.ts'), logLevel: 'warn',
    plugins: [{ name: 'isolated-log-boundary', enforce: 'pre', resolveId(source, importer) {
      if (source === '../logger.js' && importer?.includes('/remote-control/')) return '\0isolated-logger';
    }, load(id) { if (id === '\0isolated-logger') return 'export const getAppLogger = () => ({info(){},warn(){}})'; } }],
    build: { lib: { entry, formats: ['es'], fileName: () => 'bundled.mjs' }, outDir: join(root, 'out'), emptyOutDir: true },
  });
  daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const address = (await once(daemon.stdout, 'data'))[0].toString().trim();
  const binary = process.env.AGENT567_TEST_ELECTRON ?? process.execPath;
  const child = spawn(binary, [join(root, 'out/bundled.mjs')], {
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, ...(process.env.AGENT567_TEST_ELECTRON ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, `Bundled input probe exited ${code}/${signal}: ${output}`);
  assert.match(output, /WAYLAND_BUNDLE_PASSED/);
  console.log(output.trim());
} finally {
  if (daemon) { const closed = once(daemon, 'exit'); daemon.kill(); await closed; }
  await rm(root, { recursive: true, force: true });
}
