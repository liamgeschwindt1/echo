#!/usr/bin/env node
// Root `npm run build` / `npm start` entry point for platforms (Railway) that
// build every service from the repository root. The app is picked from
// ECHO_APP, or else from RAILWAY_SERVICE_NAME (e.g. "backend-", "sim", "echo").
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APPS = ['backend', 'sim', 'echo'];
// Started with node directly (not via npm) so SIGTERM reaches the server.
const ENTRY = { backend: 'src/index.js', sim: 'server.js', echo: 'server.js' };
const action = process.argv[2];

if (action !== 'build' && action !== 'start') {
  console.error('usage: node scripts/service.mjs <build|start>');
  process.exit(2);
}

function resolveApp(env = process.env) {
  const raw = (env.ECHO_APP || env.RAILWAY_SERVICE_NAME || '').toLowerCase();
  const name = raw.replace(/[^a-z]/g, '');
  return APPS.find((app) => name === app || name.startsWith(app)) || null;
}

const app = resolveApp();
if (!app) {
  console.error(
    `Cannot tell which app to ${action}. Set ECHO_APP to one of: ${APPS.join(', ')} ` +
      `(RAILWAY_SERVICE_NAME=${JSON.stringify(process.env.RAILWAY_SERVICE_NAME || '')}).`,
  );
  process.exit(1);
}

console.log(`[service] ${action} ${app}`);
const child =
  action === 'start'
    ? spawn(process.execPath, [ENTRY[app]], {
        cwd: fileURLToPath(new URL(`../apps/${app}/`, import.meta.url)),
        stdio: 'inherit',
      })
    : spawn('npm', ['run', `build:${app}`], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
