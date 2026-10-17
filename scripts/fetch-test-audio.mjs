import { mkdir, readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../public/test-audio/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
const base = `https://raw.githubusercontent.com/karolpiczak/ESC-50/${manifest.revision}/`;
await mkdir(dir, { recursive: true });

async function download(remote, local) {
  const response = await fetch(base + remote);
  if (!response.ok) throw new Error(`${remote}: HTTP ${response.status}`);
  await writeFile(new URL(local, dir), Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded ${local}`);
}

await download('LICENSE', 'LICENSE.esc50');
await download('meta/esc50.csv', 'esc50.csv');
for (const clip of manifest.clips) {
  if (clip.file) await download(`audio/${clip.file}`, clip.file);
}
