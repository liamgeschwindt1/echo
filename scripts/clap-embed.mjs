// Precomputes the CLAP text side (section 5.3) so phones never load the 126 MB text tower.
// Run after editing prompts in public/config/labels.json:  npm run clap:embed
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AutoTokenizer, ClapTextModelWithProjection } from '@xenova/transformers';
import { promptsHash } from '../src/core/catalogue.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const labelsPath = join(root, 'public', 'config', 'labels.json');
const outPath = join(root, 'public', 'config', 'clap_text_embeddings.json');
const MODEL_ID = 'Xenova/clap-htsat-unfused';

const normalize = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await ClapTextModelWithProjection.from_pretrained(MODEL_ID);

const classes = [];
for (const c of labels.classes) {
  const texts = c.prompts.map((p) => labels.clap_template.replace('{phrase}', p));
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const dim = text_embeds.dims.at(-1);
  const mean = new Array(dim).fill(0);
  for (let i = 0; i < texts.length; i++) {
    const row = normalize(Array.from(text_embeds.data.slice(i * dim, (i + 1) * dim)));
    for (let d = 0; d < dim; d++) mean[d] += row[d] / texts.length;
  }
  classes.push({ id: c.id, embedding: normalize(mean).map((x) => Math.round(x * 1e6) / 1e6) });
  process.stdout.write('.');
}

writeFileSync(
  outPath,
  JSON.stringify({ model: MODEL_ID, template: labels.clap_template, prompts_hash: promptsHash(labels), dim: classes[0].embedding.length, classes })
);
console.log(`\nWrote ${classes.length} class embeddings to ${outPath}`);
