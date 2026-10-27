// Copies MediaPipe's and ONNX Runtime's wasm out of node_modules so they are served from our own host.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// npm workspaces hoist dependencies to the repository root, so look there as well as next to this package.
const modulesDir = [join(__dirname, '..', 'node_modules'), join(__dirname, '..', '..', '..', 'node_modules')].find((d) => existsSync(join(d, '@mediapipe', 'tasks-audio')));
if (!modulesDir) throw new Error('@mediapipe/tasks-audio is not installed');
const src = join(modulesDir, '@mediapipe', 'tasks-audio', 'wasm');
const dest = join(__dirname, '..', 'public', 'wasm');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied MediaPipe wasm files to ${dest}`);

const ortSrc = join(modulesDir, '@xenova', 'transformers', 'dist');
const ortDest = join(__dirname, '..', 'public', 'ort');
mkdirSync(ortDest, { recursive: true });
for (const f of readdirSync(ortSrc).filter((f) => f.endsWith('.wasm'))) cpSync(join(ortSrc, f), join(ortDest, f));
console.log(`Copied ONNX Runtime wasm files to ${ortDest}`);
