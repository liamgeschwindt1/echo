import { FilesetResolver, AudioClassifier } from '@mediapipe/tasks-audio';
import { buildCatalogue, promptsHash } from '@echo/shared/catalogue.js';
import { DEFAULTS } from '@echo/shared/settings.js';
import { yamnetScores } from '@echo/shared/clap.js';

let cat = null;
let labelsRaw = null;
let yamnet = null;
let clapWorker = null;
let seq = 0;

export async function loadCatalogue() {
  if (cat) return cat;
  const [labels, priorities] = await Promise.all(['labels.json', 'priorities.json'].map((n) => fetch(`/config/${n}`).then((r) => r.json())));
  labelsRaw = labels;
  cat = buildCatalogue(labels, priorities);
  return cat;
}

async function loadYamnet() {
  if (yamnet) return;
  const fileset = await FilesetResolver.forAudioTasks('/wasm');
  yamnet = await AudioClassifier.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/model/yamnet.tflite' }, maxResults: -1 });
}

function loadClap(onProgress) {
  if (clapWorker) return Promise.resolve();
  clapWorker = new Worker(new URL('../../echo/src/clapWorker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    clapWorker.onerror = (e) => reject(new Error(e.message || 'CLAP worker crashed'));
    clapWorker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') resolve();
      else if (m.type === 'error') reject(new Error(m.message));
      else if (m.type === 'progress' && m.progress?.status === 'progress' && m.progress.total) onProgress?.(`Loading CLAP ${Math.round((m.progress.loaded / m.progress.total) * 100)}%`);
    };
    clapWorker.postMessage({
      type: 'init',
      classMeta: cat.classes.map((c) => ({ id: c.id, family: c.family })),
      embeddingsUrl: '/config/clap_text_embeddings.json',
      promptsHash: promptsHash(labelsRaw)
    });
  });
}

export async function loadRunners(onStatus) {
  await loadCatalogue();
  onStatus?.('Loading YAMNet');
  await loadYamnet();
  await loadClap(onStatus);
  return {
    cat,
    runners: {
      yamnet: async (samples) => {
        const scores = yamnetScores(yamnet.classify(samples, 16000)[0]?.classifications?.[0]?.categories);
        // Yield so the progress bar and timeline stay responsive.
        await new Promise((r) => setTimeout(r));
        return scores;
      },
      clap: (samples, windowS) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          const onMsg = (e) => {
            const m = e.data;
            if (m.requestId !== id) return;
            clapWorker.removeEventListener('message', onMsg);
            if (m.type === 'result') resolve(Object.fromEntries(m.scores.map((s) => [s.id, { softmax: s.softmax, cosine: s.cosine }])));
            else reject(new Error(m.message || 'CLAP window skipped'));
          };
          clapWorker.addEventListener('message', onMsg);
          clapWorker.postMessage(
            { type: 'classify', requestId: id, audio: samples.buffer, nativeRate: 48000, timestamp: 0, windowS, logitScale: DEFAULTS.clap_logit_scale },
            [samples.buffer]
          );
        })
    }
  };
}
