// Model input handling and scoring shared by every CLAP and YAMNet runner: the echo app's CLAP worker, the sim app's
// browser runners and the simulator's Node runners. One copy, so the three cannot drift.
// Only the audio tower runs; text embeddings are precomputed (packages/assets/scripts/clap-embed.mjs).

export const CLAP_MODEL_ID = 'Xenova/clap-htsat-unfused';
export const CLAP_SAMPLE_RATE = 48000;
export const CLAP_INPUT_SAMPLES = 480000; // the encoder's fixed 10 s input
export const CLAP_PAD_MODE = 'repeat';
// Fallback only; callers pass settings.clap_logit_scale. exp(2.9264452) = 18.66, source unconfirmed.
export const DEFAULT_LOGIT_SCALE = Math.exp(2.9264452);
export const YAMNET_SAMPLE_RATE = 16000;

export function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input;
  const dstLength = Math.round((input.length * dstRate) / srcRate);
  const output = new Float32Array(dstLength);
  const ratio = srcRate / dstRate;
  for (let i = 0; i < dstLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = input[idx] || 0;
    const s1 = idx + 1 < input.length ? input[idx + 1] : s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

// Shorter windows (5 s) are tiled to fill the 10 s input rather than zero-padded.
export function fitToModel(audio) {
  if (audio.length >= CLAP_INPUT_SAMPLES) return audio.subarray(audio.length - CLAP_INPUT_SAMPLES);
  const out = new Float32Array(CLAP_INPUT_SAMPLES);
  for (let i = 0; i < CLAP_INPUT_SAMPLES; i += audio.length) out.set(audio.subarray(0, Math.min(audio.length, CLAP_INPUT_SAMPLES - i)), i);
  return out;
}

export function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Text embeddings checked against the catalogue: classes [{ id, family, embedding: Float32Array }].
 * emb: the parsed clap_text_embeddings.json; classMeta: [{ id, family }]; hash: promptsHash(labels).
 */
export function clapClasses(emb, classMeta, hash) {
  if (emb.prompts_hash !== hash) throw new Error('text embeddings are out of date; run "npm run clap:embed"');
  const byId = new Map(emb.classes.map((c) => [c.id, c.embedding]));
  return classMeta.map((c) => {
    const e = byId.get(c.id);
    if (!e) throw new Error(`no text embedding for ${c.id}`);
    return { id: c.id, family: c.family, embedding: Float32Array.from(e) };
  });
}

/** Cosine against each class's text embedding, then softmax at the logit scale: [{ id, family, cosine, softmax }]. */
export function clapScores(audioEmbed, classes, logitScale) {
  let norm = 0;
  for (let i = 0; i < audioEmbed.length; i++) norm += audioEmbed[i] * audioEmbed[i];
  norm = Math.sqrt(norm) || 1;
  const cosine = classes.map((c) => {
    let dot = 0;
    for (let d = 0; d < audioEmbed.length; d++) dot += (audioEmbed[d] / norm) * c.embedding[d];
    return dot;
  });
  const scale = Number.isFinite(logitScale) && logitScale > 0 ? logitScale : DEFAULT_LOGIT_SCALE;
  const probs = softmax(cosine.map((s) => s * scale));
  return { scores: classes.map((c, i) => ({ id: c.id, family: c.family, cosine: cosine[i], softmax: probs[i] })), logitScale: scale };
}

/** MediaPipe AudioClassifier categories to { className: score }, scores of at least 0.001, rounded to 4 places. */
export function yamnetScores(categories) {
  const scores = {};
  for (const c of categories || []) if (c.score >= 0.001) scores[c.categoryName || c.displayName] = Math.round(c.score * 1e4) / 1e4;
  return scores;
}
