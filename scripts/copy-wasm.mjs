// Copies MediaPipe's and ONNX Runtime's wasm out of node_modules so they are served from our own host.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-audio', 'wasm');
const dest = join(__dirname, '..', 'public', 'wasm');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied MediaPipe wasm files to ${dest}`);

const ortSrc = join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'dist');
const ortDest = join(__dirname, '..', 'public', 'ort');
mkdirSync(ortDest, { recursive: true });
for (const f of readdirSync(ortSrc).filter((f) => f.endsWith('.wasm'))) cpSync(join(ortSrc, f), join(ortDest, f));
console.log(`Copied ONNX Runtime wasm files to ${ortDest}`);
