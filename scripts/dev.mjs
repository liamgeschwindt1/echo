// Starts backend, echo and sim together for local development. Ctrl+C stops all three.
import { spawn } from 'node:child_process';

const services = [
  { name: 'backend', color: 33, args: ['run', 'dev', '-w', '@echo/backend'] },
  { name: 'echo', color: 36, args: ['run', 'dev', '-w', '@echo/echo'] },
  { name: 'sim', color: 35, args: ['run', 'dev', '-w', '@echo/sim'] }
];

const children = services.map(({ name, color, args }) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
