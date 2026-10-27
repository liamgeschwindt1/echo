// Downloads the CLAP audio tower into public/models so the app self-hosts it (no runtime CDN calls).
// Only the audio side is needed in the browser; text embeddings ship in public/config.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL_ID = 'Xenova/clap-htsat-unfused';
const REVISION = 'main';
const FILES = ['config.json', 'preprocessor_config.json', 'onnx/audio_model_quantized.onnx'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'models', MODEL_ID);

for (const file of FILES) {
  const out = join(dest, file);
  if (existsSync(out) && statSync(out).size > 0) continue;
  mkdirSync(dirname(out), { recursive: true });
  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  console.log(`Downloaded ${file}`);
}
console.log(`CLAP audio model ready in ${dest}`);
