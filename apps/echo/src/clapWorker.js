// CLAP zero-shot classification off the main thread. Audio in, class scores out; nothing else leaves.
// Only the audio tower runs here. Text embeddings are precomputed (scripts/clap-embed.mjs).
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@xenova/transformers';
import { CLAP_MODEL_ID, CLAP_SAMPLE_RATE, CLAP_PAD_MODE, resampleLinear, fitToModel, clapClasses, clapScores } from '@echo/shared/clap.js';

// Self-hosted model and runtime (section 2/3): no CDN requests.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/ort/';
env.backends.onnx.wasm.numThreads = 1;

let processor = null;
let audioModel = null;
let classes = []; // [{ id, family, embedding: Float32Array }]
let busy = false;

async function init({ classMeta, embeddingsUrl, promptsHash }) {
  const res = await fetch(embeddingsUrl);
  if (!res.ok) throw new Error(`text embeddings missing (${res.status})`);
  classes = clapClasses(await res.json(), classMeta, promptsHash);
  const onProgress = (progress) => self.postMessage({ type: 'progress', progress });
  processor = await AutoProcessor.from_pretrained(CLAP_MODEL_ID);
  audioModel = await ClapAudioModelWithProjection.from_pretrained(CLAP_MODEL_ID, { progress_callback: onProgress });
}

async function classify(msg) {
  const startedAt = performance.now();
  const audio = fitToModel(resampleLinear(new Float32Array(msg.audio), msg.nativeRate || CLAP_SAMPLE_RATE, CLAP_SAMPLE_RATE));
  const inputs = await processor(audio);
  const { audio_embeds } = await audioModel(inputs);
  const { scores, logitScale } = clapScores(audio_embeds.data, classes, msg.logitScale);
  return { scores, inferMs: Math.round(performance.now() - startedAt), logitScale };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      await init(msg);
      self.postMessage({ type: 'ready', padMode: CLAP_PAD_MODE });
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
      self.postMessage({ type: 'error', requestId: msg.requestId, message: String(err?.message || err) });
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
