/**
 * Polling-based dev runner for environments where inotify doesn't work
 * (notably WSL2 on /mnt/c, which is a 9p/drvfs mount). It restarts `tsx`
 * on changes under src/, and lets the app's own (polling) chokidar watcher
 * hot-reload plugins/. Use the native `npm run dev` whenever you can — this is
 * only needed when file events aren't delivered.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import chokidar from 'chokidar';

const tsxBin = resolve('node_modules/.bin/tsx');
const childEnv = { ...process.env, WATCH_POLLING: '1' };

let child;
function start() {
  child = spawn(tsxBin, ['src/index.ts'], { stdio: 'inherit', env: childEnv });
}
function restart() {
  if (child) child.kill('SIGTERM');
  start();
}

start();

let timer;
const watcher = chokidar.watch(['src', 'plugins'], { ignoreInitial: true, usePolling: true, interval: 300 });
watcher.on('all', (_event, path) => {
  if (!/\.(ts|js|mjs|json|html)$/.test(path)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[dev:poll] change in ${path} — restarting`);
    restart();
  }, 150);
});

console.log('[dev:poll] polling src/ and plugins/ for changes');

function shutdown() {
  watcher.close();
  if (child) child.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
