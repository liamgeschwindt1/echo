// Runs CLAP zero-shot audio classification off the main thread so the UI
// stays smooth. Audio in, label scores out — nothing else leaves this worker.
import { pipeline, env } from '@xenova/transformers';

// Model and WASM/ONNX runtime files are fetched from the HF CDN on first
// load and cached by the browser's HTTP cache / our service worker; nothing
// here is run on a server we control, but no audio ever leaves this worker.
env.allowLocalModels = false;

const MODEL_ID = 'Xenova/clap-htsat-unfused';
const CLAP_SAMPLE_RATE = 48000; // per the model's preprocessor_config.json

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

let classifierPromise = null;
let promptTemplate = 'This is a sound of {}.';
let candidateLabels = []; // flattened phrasings
let labelToClass = new Map(); // phrasing -> { id, family, relevant }

function setPrompts(prompts) {
  candidateLabels = [];
  labelToClass = new Map();
  for (const p of prompts) {
    for (const phrase of p.phrasings) {
      candidateLabels.push(phrase);
      labelToClass.set(phrase, p);
    }
  }
}

async function getClassifier(onProgress) {
  if (!classifierPromise) {
    classifierPromise = pipeline('zero-shot-audio-classification', MODEL_ID, {
      progress_callback: onProgress
    });
  }
  return classifierPromise;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    setPrompts(msg.prompts);
    if (msg.promptTemplate) promptTemplate = msg.promptTemplate;
    try {
      await getClassifier((progress) => {
        self.postMessage({ type: 'progress', progress });
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'setPromptTemplate') {
    promptTemplate = msg.promptTemplate;
    return;
  }

  if (msg.type === 'classify') {
    try {
      const classifier = await getClassifier();
      const raw = new Float32Array(msg.audio);
      const audio = resampleLinear(raw, msg.nativeRate || CLAP_SAMPLE_RATE, CLAP_SAMPLE_RATE);
      const hypothesis_template = promptTemplate.includes('{}') ? promptTemplate : '{}';
      const output = await classifier(audio, candidateLabels, { hypothesis_template });

      // output: [{ label, score }] softmax over ALL phrasings (includes
      // negatives/context), already what §2.2 asks for. Average phrasings
      // within a class to get one softmax score and one cosine-ish score
      // per class id. (Simplification: averaging post-softmax phrasing
      // probabilities rather than pre-softmax text-embedding averaging —
      // documented in instructions_v2.md §2.2 as an acceptable variant.)
      const perClass = new Map(); // id -> { sum, count, family, relevant }
      for (const { label, score } of output) {
        const cls = labelToClass.get(label);
        if (!cls) continue;
        const entry = perClass.get(cls.id) || { sum: 0, count: 0, family: cls.family, relevant: cls.relevant };
        entry.sum += score;
        entry.count += 1;
        perClass.set(cls.id, entry);
      }
      const scores = [];
      for (const [id, entry] of perClass) {
        scores.push({
          id,
          family: entry.family,
          relevant: entry.relevant,
          softmax: entry.sum / entry.count,
          cosine: entry.sum / entry.count
        });
      }
      self.postMessage({ type: 'result', requestId: msg.requestId, scores, timestamp: msg.timestamp });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  }
};
