// CLAP zero-shot classification off the main thread. Audio in, class scores out; nothing else leaves.
// Only the audio tower runs here. Text embeddings are precomputed (scripts/clap-embed.mjs).
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@xenova/transformers';

// Self-hosted model and runtime (section 2/3): no CDN requests.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/ort/';
env.backends.onnx.wasm.numThreads = 1;

const MODEL_ID = 'Xenova/clap-htsat-unfused';
const CLAP_SAMPLE_RATE = 48000;
const MODEL_INPUT_SAMPLES = 480000; // the encoder's fixed 10 s input

// Fallback only; the app sends settings.clap_logit_scale. exp(2.9264452) = 18.66, source unconfirmed.
const DEFAULT_LOGIT_SCALE = Math.exp(2.9264452);
const PAD_MODE = 'repeat';

function resampleLinear(input, srcRate, dstRate) {
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
function fitToModel(audio) {
  if (audio.length >= MODEL_INPUT_SAMPLES) return audio.subarray(audio.length - MODEL_INPUT_SAMPLES);
  const out = new Float32Array(MODEL_INPUT_SAMPLES);
  for (let i = 0; i < MODEL_INPUT_SAMPLES; i += audio.length) out.set(audio.subarray(0, Math.min(audio.length, MODEL_INPUT_SAMPLES - i)), i);
  return out;
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

let processor = null;
let audioModel = null;
let classes = []; // [{ id, family, embedding: Float32Array }]
let busy = false;

async function init({ classMeta, embeddingsUrl, promptsHash }) {
  const res = await fetch(embeddingsUrl);
  if (!res.ok) throw new Error(`text embeddings missing (${res.status})`);
  const emb = await res.json();
  if (emb.prompts_hash !== promptsHash) throw new Error('text embeddings are out of date; run "npm run clap:embed"');
  const byId = new Map(emb.classes.map((c) => [c.id, c.embedding]));
  classes = classMeta.map((c) => {
    const e = byId.get(c.id);
    if (!e) throw new Error(`no text embedding for ${c.id}`);
    return { id: c.id, family: c.family, embedding: Float32Array.from(e) };
  });
  const onProgress = (progress) => self.postMessage({ type: 'progress', progress });
  processor = await AutoProcessor.from_pretrained(MODEL_ID);
  audioModel = await ClapAudioModelWithProjection.from_pretrained(MODEL_ID, { progress_callback: onProgress });
}

async function classify(msg) {
  const startedAt = performance.now();
  const audio = fitToModel(resampleLinear(new Float32Array(msg.audio), msg.nativeRate || CLAP_SAMPLE_RATE, CLAP_SAMPLE_RATE));
  const inputs = await processor(audio);
  const { audio_embeds } = await audioModel(inputs);
  const a = audio_embeds.data;
  let norm = 0;
  for (let i = 0; i < a.length; i++) norm += a[i] * a[i];
  norm = Math.sqrt(norm) || 1;

  const cosine = classes.map((c) => {
    let dot = 0;
    for (let d = 0; d < a.length; d++) dot += (a[d] / norm) * c.embedding[d];
    return dot;
  });
  const scale = Number.isFinite(msg.logitScale) && msg.logitScale > 0 ? msg.logitScale : DEFAULT_LOGIT_SCALE;
  const probs = softmax(cosine.map((s) => s * scale));
  const scores = classes.map((c, i) => ({ id: c.id, family: c.family, cosine: cosine[i], softmax: probs[i] }));
  return { scores, inferMs: Math.round(performance.now() - startedAt), logitScale: scale };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      await init(msg);
      self.postMessage({ type: 'ready', padMode: PAD_MODE });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }
  if (msg.type === 'classify') {
    // Never overlap runs: a tick that arrives mid-run is dropped, not queued.
    if (busy || !audioModel) {
      self.postMessage({ type: 'skipped', requestId: msg.requestId });
      return;
    }
    busy = true;
    try {
      const { scores, inferMs, logitScale } = await classify(msg);
      self.postMessage({ type: 'result', requestId: msg.requestId, scores, timestamp: msg.timestamp, windowS: msg.windowS, inferMs, logitScale });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    } finally {
      busy = false;
    }
  }
};

self.addEventListener('error', (event) => {
  busy = false;
  self.postMessage({ type: 'error', message: event.message || 'worker error' });
});
self.addEventListener('unhandledrejection', (event) => {
  busy = false;
  self.postMessage({ type: 'error', message: String(event.reason?.message || event.reason) });
});
