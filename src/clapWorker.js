// Runs CLAP zero-shot audio classification off the main thread so the UI
// stays smooth. Audio in, label scores out — nothing else leaves this worker.
//
// Perf note (§2): the high-level `pipeline('zero-shot-audio-classification')`
// helper re-encodes every text prompt through the full text tower on *every*
// call, because it runs text+audio together through the combined model.onnx
// graph. With ~190 phrasings that dominates inference time and is why CLAP
// was only managing one run every ~37s on an iPhone. Text embeddings never
// change between ticks (only when prompts/template change), so instead we
// load the audio and text towers as two separate ONNX graphs
// (ClapAudioModelWithProjection / ClapTextModelWithProjection), encode all
// text phrasings once and cache the result, and run only the much smaller
// audio tower on every tick.
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  ClapTextModelWithProjection,
  ClapAudioModelWithProjection
} from '@xenova/transformers';

// Model and WASM/ONNX runtime files are fetched from the HF CDN on first
// load and cached by the browser's HTTP cache / our service worker; nothing
// here is run on a server we control, but no audio ever leaves this worker.
env.allowLocalModels = false;

const MODEL_ID = 'Xenova/clap-htsat-unfused';
const CLAP_SAMPLE_RATE = 48000; // per the model's preprocessor_config.json

// §1 fix: `config.json`'s `logit_scale_init_value` (~14.29, used for both
// towers at init) is NOT the value actually used by this checkpoint's audio
// tower after training — it only reflects the untrained starting point. The
// real trained scale is the `logit_scale_a` initializer baked into
// onnx/model(_quantized).onnx. Verified directly from that graph with the
// `onnx` python package:
//   logit_scale_a (raw/log) = 2.9264452  =>  exp(2.9264452) ≈ 18.6612
// This is the "T" in `p_i = exp(s_i * T) / sum_j exp(s_j * T)`. If the
// upstream checkpoint is ever updated, re-extract this the same way rather
// than guessing — do not reuse the ~100 figure from config.json.
const LOGIT_SCALE_A = Math.exp(2.9264452);

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

// L2-normalizes each row of a flattened (numRows x dim) array in place and
// returns it, matching the normalization CLAP applies internally before the
// cosine-similarity step (otherwise raw projection-head outputs are *not*
// unit vectors and the dot product is not a true cosine similarity).
function l2NormalizeRows(data, numRows, dim) {
  for (let r = 0; r < numRows; r++) {
    const offset = r * dim;
    let sumSq = 0;
    for (let i = 0; i < dim; i++) sumSq += data[offset + i] * data[offset + i];
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < dim; i++) data[offset + i] /= norm;
  }
  return data;
}

function softmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  let sum = 0;
  const exps = new Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }
  for (let i = 0; i < exps.length; i++) exps[i] /= sum;
  return exps;
}

let tokenizerPromise = null;
let textModelPromise = null;
let processorPromise = null;
let audioModelPromise = null;

let prompts = []; // raw prompt definitions from main thread
let promptTemplate = 'This is a sound of {}.';

let textEmbeds = null; // Float32Array, flattened (numPhrasings x dim), L2-normalized
let embedDim = 0;
let phrasingMeta = []; // aligned with textEmbeds rows: { id, family, relevant }

let busy = false; // defence in depth; main thread is expected to gate this too

function getTokenizer() {
  if (!tokenizerPromise) tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  return tokenizerPromise;
}

function getTextModel(onProgress) {
  if (!textModelPromise) {
    textModelPromise = ClapTextModelWithProjection.from_pretrained(MODEL_ID, { progress_callback: onProgress });
  }
  return textModelPromise;
}

function getProcessor() {
  if (!processorPromise) processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  return processorPromise;
}

function getAudioModel(onProgress) {
  if (!audioModelPromise) {
    audioModelPromise = ClapAudioModelWithProjection.from_pretrained(MODEL_ID, { progress_callback: onProgress });
  }
  return audioModelPromise;
}

// Encodes every phrasing of every prompt through the text tower once and
// caches the (normalized) result. Only needs to re-run when the prompt list
// or the hypothesis template changes, not on every classify tick.
async function encodeTextPrompts(onProgress) {
  const tokenizer = await getTokenizer();
  const textModel = await getTextModel(onProgress);

  const texts = [];
  const meta = [];
  for (const p of prompts) {
    for (const phrase of p.phrasings) {
      texts.push(promptTemplate.includes('{}') ? promptTemplate.replace('{}', phrase) : phrase);
      meta.push({ id: p.id, family: p.family, relevant: p.relevant });
    }
  }

  const text_inputs = tokenizer(texts, { padding: true, truncation: true });
  const output = await textModel(text_inputs);
  const dim = output.text_embeds.dims.at(-1);
  const flat = Float32Array.from(output.text_embeds.data);
  textEmbeds = l2NormalizeRows(flat, texts.length, dim);
  embedDim = dim;
  phrasingMeta = meta;
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    prompts = msg.prompts;
    if (msg.promptTemplate) promptTemplate = msg.promptTemplate;
    try {
      const onProgress = (progress) => self.postMessage({ type: 'progress', progress });
      await getProcessor();
      await getAudioModel(onProgress);
      await encodeTextPrompts(onProgress);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'setPromptTemplate') {
    promptTemplate = msg.promptTemplate;
    try {
      await encodeTextPrompts();
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'classify') {
    // §2 fix: never start a run while one is in progress. If the main thread
    // somehow sends another tick anyway (e.g. a race during a cadence
    // change), skip it instead of queueing / piling up overlapping runs.
    if (busy || !textEmbeds) return;
    busy = true;
    const startedAt = performance.now();
    try {
      const processor = await getProcessor();
      const audioModel = await getAudioModel();

      const raw = new Float32Array(msg.audio);
      const audio = resampleLinear(raw, msg.nativeRate || CLAP_SAMPLE_RATE, CLAP_SAMPLE_RATE);

      const audio_inputs = await processor(audio);
      const { audio_embeds } = await audioModel(audio_inputs);
      const dim = audio_embeds.dims.at(-1);
      const aEmb = l2NormalizeRows(Float32Array.from(audio_embeds.data), 1, dim);

      // Raw cosine similarity per phrasing (pre-softmax), then the real
      // softmax (§1) across *all* phrasings, including negatives/context.
      const numPhrasings = phrasingMeta.length;
      const cosinePerPhrasing = new Array(numPhrasings);
      const logitsPerPhrasing = new Array(numPhrasings);
      for (let i = 0; i < numPhrasings; i++) {
        const offset = i * embedDim;
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += aEmb[d] * textEmbeds[offset + d];
        cosinePerPhrasing[i] = dot;
        logitsPerPhrasing[i] = dot * LOGIT_SCALE_A;
      }
      const probsPerPhrasing = softmax(logitsPerPhrasing);

      // Group phrasings back into classes. The per-class softmax is the SUM
      // of its phrasings' probabilities (the class's true marginal
      // probability within the full candidate set), not an average — an
      // average would shrink the total across classes well below 1 (exactly
      // the "scores summed to ~0.3" bug). `cosine` is the *raw* similarity
      // of the class's best-matching phrasing, deliberately left unscaled
      // so it differs from `softmax`.
      const perClass = new Map(); // id -> { softmax, cosine, family, relevant }
      for (let i = 0; i < numPhrasings; i++) {
        const meta = phrasingMeta[i];
        const entry = perClass.get(meta.id) || { softmax: 0, cosine: -Infinity, family: meta.family, relevant: meta.relevant };
        entry.softmax += probsPerPhrasing[i];
        if (cosinePerPhrasing[i] > entry.cosine) entry.cosine = cosinePerPhrasing[i];
        perClass.set(meta.id, entry);
      }

      const scores = [];
      for (const [id, entry] of perClass) {
        scores.push({ id, family: entry.family, relevant: entry.relevant, softmax: entry.softmax, cosine: entry.cosine });
      }

      const inferMs = Math.round(performance.now() - startedAt);
      self.postMessage({ type: 'result', requestId: msg.requestId, scores, timestamp: msg.timestamp, inferMs });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    } finally {
      busy = false;
    }
  }
};

// Catch uncaught worker errors (e.g. WASM OOM) so the UI can show
// "CLAP stopped: reason" instead of silently freezing on the last result.
self.addEventListener('error', (event) => {
  busy = false;
  self.postMessage({ type: 'error', message: event.message || 'worker error' });
});
self.addEventListener('unhandledrejection', (event) => {
  busy = false;
  const reason = event.reason;
  self.postMessage({ type: 'error', message: String(reason && reason.message ? reason.message : reason) });
});
