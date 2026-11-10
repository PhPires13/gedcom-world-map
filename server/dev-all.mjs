// Runs the API server (restarting on changes) and the Vite dev server together.
// Ctrl+C stops both. Used by `npm run dev:all`.

import { spawn } from 'node:child_process';

const procs = [
  ['api', ['tsx', 'watch', '--clear-screen=false', 'server/main.ts']],
  ['web', ['vite', ...process.argv.slice(2)]],
].map(([name, args]) => {
  const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = name === 'api' ? '\x1b[35m[api]\x1b[0m ' : '\x1b[36m[web]\x1b[0m ';
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    stop(code ?? 0);
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
