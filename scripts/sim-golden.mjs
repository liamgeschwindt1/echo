import { mkdirSync, writeFileSync } from 'node:fs';
import { goldenFor } from '../test/golden-lib.js';
import { GOLDEN_SCENES } from '../test/golden-scenes.js';

const out = Object.fromEntries(Object.keys(GOLDEN_SCENES).map((name) => [name, goldenFor(name)]));
const file = process.argv[2] || 'test/golden/golden.json';
mkdirSync(new URL('../test/golden/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../${file}`, import.meta.url), JSON.stringify(out));
console.log(`wrote ${file}`);
