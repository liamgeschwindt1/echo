// YAMNet and CLAP runners for Node, so the simulator itself (tests, scripts, batch runs) labels with the real models.
// Same models, files and scoring as the browser runners (apps/sim/src/models.js) and the echo app's CLAP worker:
// YAMNet is the MediaPipe AudioClassifier on packages/assets/public/model/yamnet.tflite, CLAP is the quantized
// Xenova/clap-htsat-unfused audio tower on onnxruntime-node, scored by @echo/shared/clap.js against the precomputed
// text embeddings. Node only (reads files); the browser app keeps its own loader.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildCatalogue, promptsHash } from '@echo/shared/catalogue.js';
import { DEFAULTS } from '@echo/shared/settings.js';
import { CLAP_MODEL_ID, CLAP_SAMPLE_RATE, YAMNET_SAMPLE_RATE, fitToModel, clapClasses, clapScores, yamnetScores } from '@echo/shared/clap.js';

const require = createRequire(import.meta.url);
const ASSETS = fileURLToPath(new URL('../../assets/public/', import.meta.url));
const YAMNET_PATH = `${ASSETS}model/yamnet.tflite`;
const CLAP_DIR = `${ASSETS}models/`;
const CLAP_ONNX = `${CLAP_DIR}${CLAP_MODEL_ID}/onnx/audio_model_quantized.onnx`;
const readJson = (name) => JSON.parse(readFileSync(`${ASSETS}config/${name}`, 'utf8'));

/** True when both model files are present (they are committed; `npm run fetch-models -w @echo/assets` restores them). */
export const nodeModelsAvailable = () => existsSync(YAMNET_PATH) && existsSync(CLAP_ONNX);

let catalogue = null;
export function loadNodeCatalogue() {
  if (!catalogue) {
    const labels = readJson('labels.json');
    catalogue = { cat: buildCatalogue(labels, readJson('priorities.json')), labels };
  }
  return catalogue;
}

// MediaPipe's loader expects a browser or a worker. Give it the worker path (importScripts) and evaluate the
// Emscripten loader as CommonJS, so it reads its .wasm from disk.
async function loadYamnet() {
  const wasm = require.resolve('@mediapipe/tasks-audio').replace(/[^/]*$/, 'wasm/');
  globalThis.self ??= globalThis;
  globalThis.importScripts ??= (path) => {
    const module = { exports: {} };
    new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(path, 'utf8'))(module, module.exports, require, wasm, path);
    globalThis.ModuleFactory = module.exports;
  };
  const { AudioClassifier } = await import('@mediapipe/tasks-audio');
  const fileset = { wasmLoaderPath: `${wasm}audio_wasm_internal.js`, wasmBinaryPath: `${wasm}audio_wasm_internal.wasm` };
  return AudioClassifier.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: new Uint8Array(readFileSync(YAMNET_PATH)) }, maxResults: -1 });
}

async function loadClap(cat, labels) {
  const { env, AutoProcessor, ClapAudioModelWithProjection } = await import('@xenova/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = CLAP_DIR;
  const classes = clapClasses(readJson('clap_text_embeddings.json'), cat.classes.map((c) => ({ id: c.id, family: c.family })), promptsHash(labels));
  const processor = await AutoProcessor.from_pretrained(CLAP_MODEL_ID);
  const model = await ClapAudioModelWithProjection.from_pretrained(CLAP_MODEL_ID, { quantized: true });
  return { classes, processor, model };
}

let loaded = null;

/**
 * { cat, runners, models } with the same runner contract as the browser (see label.js):
 * runners.yamnet(samples16k) -> { className: score }, runners.clap(samples48k, windowS) -> { classId: { softmax, cosine } }.
 * Models load once per process and are cached. logitScale defaults to the app setting.
 */
export async function loadNodeRunners({ logitScale = DEFAULTS.clap_logit_scale } = {}) {
  if (!loaded) {
    const { cat, labels } = loadNodeCatalogue();
    const [yamnet, clap] = await Promise.all([loadYamnet(), loadClap(cat, labels)]);
    loaded = { cat, yamnet, clap };
  }
  const { cat, yamnet, clap } = loaded;
  return {
    cat,
    models: {
      yamnet: { file: 'model/yamnet.tflite', runtime: 'MediaPipe tasks-audio 1.1.0 (WASM, Node)', sample_rate: YAMNET_SAMPLE_RATE },
      clap: { id: CLAP_MODEL_ID, file: 'onnx/audio_model_quantized.onnx', runtime: 'transformers.js 2 / onnxruntime-node', sample_rate: CLAP_SAMPLE_RATE, logit_scale: logitScale, logit_scale_placeholder: true }
    },
    runners: {
      yamnet: async (samples) => yamnetScores(yamnet.classify(samples, YAMNET_SAMPLE_RATE)[0]?.classifications?.[0]?.categories),
      clap: async (samples) => {
        const audio = fitToModel(Float32Array.from(samples)); // label.js passes rendered 48 kHz audio
        const { audio_embeds } = await clap.model(await clap.processor(audio));
        const { scores } = clapScores(audio_embeds.data, clap.classes, logitScale);
        return Object.fromEntries(scores.map((s) => [s.id, { softmax: s.softmax, cosine: s.cosine }]));
      }
    }
  };
}

/** Releases the YAMNet graph so the process can exit. */
export function closeNodeRunners() {
  loaded?.yamnet.close();
  loaded = null;
}
