// Copies MediaPipe's wasm runtime out of node_modules so it is served from our own host.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-audio', 'wasm');
const dest = join(__dirname, '..', 'public', 'wasm');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied MediaPipe wasm files to ${dest}`);
